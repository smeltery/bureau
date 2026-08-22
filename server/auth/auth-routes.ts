import type { Server } from "bun";
import { getUserByName } from "../users.ts";
import { acceptInvite, clearCookieHeaders, logoutBySessionHash, peekInvite, readSessionCookie, setCookieHeader, validateSession, wouldRevokeLeaveOfficeUnreachable, type InvitePeek } from "./auth.ts";
import { renderAcceptPage, renderInviteError, renderInviteIdentityConflict, renderLockoutBlocked, securityHeaders } from "./auth-pages.ts";
import { handleClaim, handleClaimForm, shouldShowClaimForm } from "./auth-claim-routes.ts";
import { checkAuthRateLimit } from "./auth-rate-limit.ts";
import { originValidForAuthPost } from "./auth-request-guards.ts";

type InviteErrorResponseDeps = {
  readSessionCookie: typeof readSessionCookie;
  validateSession: typeof validateSession;
};

type InviteIdentityConflictDeps = InviteErrorResponseDeps & {
  getUserByName: typeof getUserByName;
};

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

export function handleInvitePeek(req: Request, token: string, officeName: string | null): Response {
  const limited = checkAuthRateLimit(req, "invite_peek");
  if (limited) return limited;
  const peek = peekInvite(token);
  if ("error" in peek) return inviteErrorResponse(req, peek.error, officeName);
  const conflict = inviteIdentityConflict(req, peek, null);
  if (conflict) return renderInviteIdentityConflict(conflict, officeName);
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
  const limited = checkAuthRateLimit(req, "invite_accept");
  if (limited) return limited;
  const form = await req.formData().catch(() => null);
  const tokenField = form?.get("token");
  const nameField = form?.get("name");
  const token = typeof tokenField === "string" ? tokenField : "";
  const name = typeof nameField === "string" ? nameField : "";
  if (!token) return renderInviteError("not_found", officeName);
  const peek = peekInvite(token);
  if (!("error" in peek)) {
    const conflict = inviteIdentityConflict(req, peek, name);
    if (conflict) return renderInviteIdentityConflict(conflict, officeName);
  }
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
    return inviteErrorResponse(req, result.error, officeName);
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

function signedInRedirectForConsumedInvite(req: Request, deps: InviteErrorResponseDeps): Response | null {
  const cookie = deps.readSessionCookie(req);
  if (!deps.validateSession(cookie)) return null;
  return new Response(null, {
    status: 302,
    headers: {
      Location: "/",
      ...securityHeaders(),
    },
  });
}

export function inviteErrorResponse(req: Request, error: string, officeName: string | null, deps: InviteErrorResponseDeps = { readSessionCookie, validateSession }): Response {
  if (error === "consumed") {
    const redirect = signedInRedirectForConsumedInvite(req, deps);
    if (redirect) return redirect;
  }
  return renderInviteError(error, officeName);
}

export function inviteIdentityConflict(
  req: Request,
  invite: InvitePeek,
  chosenName: string | null,
  deps: InviteIdentityConflictDeps = { readSessionCookie, validateSession, getUserByName },
): { current: string; invitee: string } | null {
  const session = deps.validateSession(deps.readSessionCookie(req));
  if (!session) return null;

  let invitee: string;
  if (invite.username !== null) {
    invitee = invite.username;
  } else {
    invitee = (chosenName ?? "").trim();
    if (!invitee || invitee.length > 64 || !/^[\p{L}\p{N} ._'-]+$/u.test(invitee)) {
      return null;
    }
  }

  const invitedUser = deps.getUserByName(invitee);
  if (invitedUser?.id === session.userId) return null;
  console.log(`[auth] invite acceptance refused: live browser session ${session.sessionPrefix} differs from invite target`);
  return { current: session.username, invitee };
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
  // Both names, as independent Set-Cookie lines (an object literal can only
  // carry one). Clearing the name that did NOT authenticate this request is
  // client-side cleanup only — the session revoked above is the one the
  // request actually selected.
  const headers = new Headers({ Location: "/", ...securityHeaders() });
  for (const line of clearCookieHeaders()) headers.append("Set-Cookie", line);
  return new Response(null, { status: 302, headers });
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
