import type { Server } from "bun";
import { acceptInvite, clearCookieHeader, logoutBySessionHash, peekInvite, readSessionCookie, setCookieHeader, validateSession, wouldRevokeLeaveOfficeUnreachable } from "./auth.ts";
import { renderAcceptPage, renderInviteError, renderLockoutBlocked, securityHeaders } from "./auth-pages.ts";
import { handleClaim, handleClaimForm, shouldShowClaimForm } from "./auth-claim-routes.ts";
import { originValidForAuthPost } from "./auth-request-guards.ts";

// Fires after the office gets its first owner — either through the tokenless
// claim form (handleClaim → claimOwnership) or the legacy bootstrap-invite
// accept path (handleAccept where isBootstrap is true). Awaited best-effort
// after the session has persisted but before the redirect response is
// returned; the hook MUST NOT roll auth state back on its own failure, and
// the caller must log + swallow any throw.
type OwnerCreatedCb = (opts: { username: string }) => Promise<void> | void;
let onOwnerCreated: OwnerCreatedCb | null = null;
export function setOnOwnerCreated(cb: OwnerCreatedCb | null): void {
  onOwnerCreated = cb;
}

export function handleInvitePeek(_req: Request, token: string, officeName: string | null): Response {
  const peek = peekInvite(token);
  if ("error" in peek) return renderInviteError(peek.error, officeName);
  return new Response(renderAcceptPage(token, peek.needsName, null, officeName), {
    status: 200,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      ...securityHeaders(),
    },
  });
}

export async function handleAccept(req: Request, officeName: string | null): Promise<Response> {
  if (!originValidForAuthPost(req)) {
    return new Response("bad origin", { status: 403 });
  }
  const form = await req.formData().catch(() => null);
  const tokenField = form?.get("token");
  const nameField = form?.get("name");
  const token = typeof tokenField === "string" ? tokenField : "";
  const name = typeof nameField === "string" ? nameField : "";
  if (!token) return renderInviteError("not_found", officeName);
  const ua = req.headers.get("user-agent");
  const result = await acceptInvite(token, { userAgent: ua, chosenName: name });
  if (!result.ok) {
    if (result.error === "needs_name" || result.error === "invalid_name") {
      return new Response(renderAcceptPage(token, true, "Please pick a display name.", officeName), {
        status: 400,
        headers: {
          "Content-Type": "text/html; charset=utf-8",
          ...securityHeaders(),
        },
      });
    }
    return renderInviteError(result.error, officeName);
  }
  if (result.isBootstrap && onOwnerCreated) {
    try {
      await onOwnerCreated({ username: result.username });
    } catch (err) {
      console.error("[auth] onOwnerCreated threw:", err);
    }
  }
  return new Response(null, {
    status: 302,
    headers: {
      Location: "/",
      "Set-Cookie": setCookieHeader(result.rawSessionId, result.absoluteExpiresAt),
      ...securityHeaders(),
    },
  });
}

export async function handleLogout(req: Request, officeName: string | null): Promise<Response> {
  if (!originValidForAuthPost(req)) {
    return new Response("bad origin", { status: 403 });
  }
  const cookie = readSessionCookie(req);
  const lookup = validateSession(cookie);
  if (lookup && wouldRevokeLeaveOfficeUnreachable(lookup.sessionIdHash)) {
    return new Response(
      renderLockoutBlocked(
        "Sign out refused: this is the last active owner session in the " + "office. Mint an additional invite for yourself and accept it " + "on another device first, then retry.",
        officeName,
      ),
      {
        status: 409,
        headers: {
          "Content-Type": "text/html; charset=utf-8",
          ...securityHeaders({ tokenInUrl: false }),
        },
      },
    );
  }
  if (lookup) {
    await logoutBySessionHash(lookup.sessionIdHash);
  }
  return new Response(null, {
    status: 302,
    headers: {
      Location: "/",
      "Set-Cookie": clearCookieHeader(),
      ...securityHeaders(),
    },
  });
}

// Top-level router used by index.ts: returns null when the path isn't an
// /auth/* path, so the caller falls through to its normal dispatch.
export async function tryHandleAuthRoute<T>(req: Request, url: URL, officeName: string | null, server: Server<T>): Promise<Response | null> {
  // Pre-claim tokenless flow. The server binds 127.0.0.1 pre-claim, so this
  // surface is unreachable from off-box; we still layer a strict same-origin
  // + loopback-peer-IP check on the POST as defense-in-depth in case the
  // bind is widened by operator override.
  if (shouldShowClaimForm(req, url)) {
    return handleClaimForm(officeName);
  }
  if (req.method === "POST" && url.pathname === "/auth/claim") {
    return handleClaim(req, server, officeName, onOwnerCreated);
  }
  // GET /i/<token> — peek + render accept page (NEVER consumes).
  if (req.method === "GET" && url.pathname.startsWith("/i/")) {
    const token = url.pathname.slice(3);
    if (!token) return renderInviteError("not_found", officeName);
    return handleInvitePeek(req, token, officeName);
  }
  if (url.pathname === "/auth/accept" && req.method === "POST") {
    return handleAccept(req, officeName);
  }
  if (url.pathname === "/auth/logout" && req.method === "POST") {
    return handleLogout(req, officeName);
  }
  return null;
}
