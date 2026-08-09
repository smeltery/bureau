import type { AuthResult } from "../auth/auth-middleware.ts";
import type { SessionWire } from "../../shared/types.ts";

const JSON_HEADERS = { "Access-Control-Allow-Origin": "*", "Content-Type": "application/json" };

export type SessionRevokeResult = "ok" | "not_found" | "ambiguous" | "would_strand_office";

export interface SessionsHttpDeps {
  list(userId: string, role: "owner" | "member"): SessionWire[];
  revoke(userId: string, role: "owner" | "member", sessionPrefix: string): Promise<SessionRevokeResult>;
  logout(sessionIdHash: string): Promise<SessionRevokeResult>;
}

/**
 * Handle active-session HTTP routes:
 *   GET    /api/sessions          — list active sessions scoped to the caller.
 *   DELETE /api/sessions/current  — sign out the caller's current session.
 *   DELETE /api/sessions/:prefix  — revoke an active session.
 *
 * Returns null for any other URL so the caller can fall through.
 */
export async function handleSessionsRequest(req: Request, url: URL, auth: AuthResult | undefined, deps: SessionsHttpDeps): Promise<Response | null> {
  const parts = sessionsRouteParts(url.pathname);
  if (!parts) return null;
  // DELIBERATELY session-only: no `privilegedAgentIdentity` path here. Revoking
  // a session kills a HUMAN's live browser session — an agent able to do that
  // could lock its own boss out of the office mid-conversation, including out of
  // the privilege toggle that would stop it. Upstream excludes `session:manage`
  // from the privileged set for the same reason. These routes are also
  // self-scoped by design (the caller's own userId), which a bearer token has no
  // meaningful analogue for.
  if (auth?.kind !== "ok") return jsonError(401, "unauthenticated");

  if (req.method === "GET" && parts.length === 1) {
    return new Response(JSON.stringify({ sessions: deps.list(auth.session.userId, auth.session.role) }), { headers: JSON_HEADERS });
  }

  if (req.method === "DELETE" && parts.length === 2 && parts[1] === "current") {
    return revokeResponse(await deps.logout(auth.session.sessionIdHash));
  }

  if (req.method === "DELETE" && parts.length === 2) {
    return revokeResponse(await deps.revoke(auth.session.userId, auth.session.role, parts[1]!));
  }

  return null;
}

function revokeResponse(result: SessionRevokeResult): Response {
  switch (result) {
    case "ok":
      return new Response(null, { status: 204, headers: JSON_HEADERS });
    case "would_strand_office":
      return jsonError(409, "would leave office without an active owner session");
    case "ambiguous":
      return jsonError(409, "ambiguous session prefix");
    case "not_found":
      return jsonError(404, "session not found");
  }
}

function sessionsRouteParts(pathname: string): string[] | null {
  const parts = pathname.split("/").filter(Boolean);
  if (parts[0] !== "api" || parts[1] !== "sessions") return null;
  return parts.slice(1);
}

function jsonError(status: number, error: string): Response {
  return new Response(JSON.stringify({ error }), { status, headers: JSON_HEADERS });
}
