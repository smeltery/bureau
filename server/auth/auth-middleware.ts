// HTTP middleware + WS upgrade auth.

import type { Server } from "bun";
import { browserSessionDiagnostic, emitBrowserSessionDiagnostic, readSessionCookies, validateSession, type SessionLookup } from "./auth.ts";
import { resolveApiToken } from "./api-tokens.ts";
import { renderLoginPage, securityHeaders } from "./auth-pages.ts";
import { checkOrigin, requestIsLoopback } from "./auth-request-guards.ts";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

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

export function authenticate<T>(req: Request, server: Server<T>, opts?: { allowLoopback?: boolean; officeName?: string | null; gate?: "http" | "ws" }): AuthResult {
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
  const bearer = req.headers.get("authorization");
  const bearerMatch = bearer ? /^bearer[ \t]+(.+)$/i.exec(bearer.trim()) : null;
  const apiToken = resolveApiToken(bearerMatch?.[1]?.trim() || null);
  if (apiToken) {
    return {
      kind: "ok",
      session: {
        sessionIdHash: `api-token:${apiToken.tokenId}`,
        sessionPrefix: "api-token",
        userId: apiToken.userId,
        username: apiToken.username,
        role: apiToken.role,
        needsRolling: false,
        absoluteExpiresAt: Number.MAX_SAFE_INTEGER,
      },
    };
  }
  if (looped) {
    return { kind: "loopback" };
  }
  const cookies = readSessionCookies(req);
  const session = validateSession(cookies.selected || null);
  emitBrowserSessionDiagnostic(browserSessionDiagnostic(cookies, session, opts?.gate ?? "http"), req);
  if (!session) {
    return { kind: "rejected", response: unauthorized(req, opts?.officeName ?? null) };
  }
  return { kind: "ok", session };
}
