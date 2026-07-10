// HTTP middleware + WS upgrade auth + /auth/* routes.

import type { Server } from "bun";
import {
  acceptInvite,
  claimOwnership,
  clearCookieHeader,
  logoutBySessionHash,
  peekInvite,
  readSessionCookie,
  setCookieHeader,
  validateSession,
  wouldRevokeLeaveOfficeUnreachable,
  type SessionLookup,
} from "./auth.ts";
import { hasOwner } from "../users.ts";
import { renderAcceptPage, renderClaimPage, renderInviteError, renderLockoutBlocked, renderLoginPage, securityHeaders } from "./auth-pages.ts";
import { checkOrigin, isLoopbackOrigin, originValidForAuthPost, requestIsLoopback } from "./auth-request-guards.ts";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

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

// ---------------------------------------------------------------------------
// Auth-result type that the index.ts dispatcher consumes.

export interface AuthOk {
  kind: "ok";
  session: SessionLookup;
}
export interface AuthLoopback {
  kind: "loopback";
}
export interface AuthRejected {
  kind: "rejected";
  response: Response;
}

export type AuthResult = AuthOk | AuthLoopback | AuthRejected;

function wantsJson(req: Request): boolean {
  const accept = req.headers.get("accept") ?? "";
  return accept.includes("application/json") || !accept.includes("text/html");
}

function unauthorized(req: Request, officeName: string | null): Response {
  if (wantsJson(req)) {
    return new Response(JSON.stringify({ error: "unauthenticated" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }
  return new Response(renderLoginPage(officeName), {
    status: 401,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      // Login page has no bearer token in its URL; skip Referrer-Policy:
      // no-referrer so any future form on this page wouldn't trip Chrome's
      // Origin: null behavior.
      ...securityHeaders({ tokenInUrl: false }),
    },
  });
}

// ---------------------------------------------------------------------------
// Gating function. Called at the top of every fetch handler.

export function authenticate<T>(req: Request, server: Server<T>, opts?: { allowLoopback?: boolean; officeName?: string | null }): AuthResult {
  const looped = !!opts?.allowLoopback && requestIsLoopback(req, server);
  // Origin check runs regardless of the cookie path. A user's browser
  // running on the same machine as the server can otherwise be tricked by
  // a malicious origin into mutating state via the agent-API endpoints
  // (CSRF). We allow missing-Origin (typical for agent curl, which never
  // sends one) but reject mismatched-Origin always.
  if (!SAFE_METHODS.has(req.method)) {
    const originHeader = req.headers.get("origin");
    if (originHeader && !checkOrigin(req)) {
      return {
        kind: "rejected",
        response: new Response(JSON.stringify({ error: "bad origin" }), {
          status: 403,
          headers: { "Content-Type": "application/json" },
        }),
      };
    }
  }
  if (looped) {
    return { kind: "loopback" };
  }
  const cookie = readSessionCookie(req);
  const session = validateSession(cookie);
  if (!session) {
    return { kind: "rejected", response: unauthorized(req, opts?.officeName ?? null) };
  }
  return { kind: "ok", session };
}

// ---------------------------------------------------------------------------
// /auth/* route handlers.

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
  if (req.method === "GET" && url.pathname === "/" && !hasOwner()) {
    return handleClaimForm(officeName);
  }
  if (req.method === "POST" && url.pathname === "/auth/claim") {
    return handleClaim(req, server, officeName);
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

// GET / when !hasOwner(): render the tokenless name-picker form. Routes
// here BEFORE the cookie gate. After claim, hasOwner() flips and this
// branch goes dead.
//
// The claim page uses `tokenInUrl: false` so `Referrer-Policy: no-referrer`
// is omitted: there's no token in the URL to leak, and Chrome's coupling
// between that header and `Origin: null` on top-level form POSTs would
// otherwise make the form's strict same-origin check reject the real
// browser submit with 403.
function handleClaimForm(officeName: string | null): Response {
  return new Response(renderClaimPage(null, officeName), {
    status: 200,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      ...securityHeaders({ tokenInUrl: false }),
    },
  });
}

// POST /auth/claim — consume the tokenless form, create the owner record,
// set the cookie. Locality is enforced at multiple layers:
//   1. The server bind (127.0.0.1 pre-claim) keeps off-box clients off the
//      TCP socket entirely;
//   2. requestIsLoopback rejects non-loopback peers if the bind has been
//      widened by operator override;
//   3. A strict same-origin check rejects ordinary browser POSTs from
//      pages on other origins (CSRF defense).
//
// The strict-Origin check does NOT close the "non-browser client forges
// Origin over a same-host proxy" case — curl can set Origin to anything,
// including the exact loopback value. This is an inherent topology limit;
// the documented mitigation is operator discipline (claim first, expose
// later — see docs/features/access-and-invites.md "Bootstrap-window
// exposure").
async function handleClaim<T>(req: Request, server: Server<T>, officeName: string | null): Promise<Response> {
  if (!requestIsLoopback(req, server)) {
    return new Response("forbidden", { status: 403 });
  }
  const origin = req.headers.get("origin");
  if (!origin || !isLoopbackOrigin(origin)) {
    return new Response("bad origin", { status: 403 });
  }
  const form = await req.formData().catch(() => null);
  const nameField = form?.get("name");
  const name = typeof nameField === "string" ? nameField : "";
  const ua = req.headers.get("user-agent");
  const result = await claimOwnership(name, { userAgent: ua });
  if (!result.ok) {
    const errorMsg =
      result.error === "owner_exists"
        ? "This office already has an owner. Refresh and sign in with an invite link instead."
        : "Please pick a display name (letters, numbers, spaces, periods, hyphens, apostrophes, or underscores).";
    return new Response(renderClaimPage(errorMsg, officeName), {
      status: 400,
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        ...securityHeaders({ tokenInUrl: false }),
      },
    });
  }
  if (onOwnerCreated) {
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
      ...securityHeaders({ tokenInUrl: false }),
    },
  });
}
