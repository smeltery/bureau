// Identity, visibility and response plumbing for the /api/apps routes. Split
// out of apps.ts so the handler file reads as the sequence of verbs and their
// commit-order rules, with the "who is asking, and what may they see" question
// answered in one place.

import * as AgentManager from "../agent-manager.ts";
import { readBearerToken, resolveAgentToken } from "../agents/tokens.ts";
import type { AuthResult } from "../auth/auth-middleware.ts";
import { getUserById } from "../users.ts";
import { AppRegistryError } from "../apps/registry.ts";
import { AppSupervisorError } from "../apps/supervisor.ts";
import type { AppErrorCode, AppRecord } from "../../shared/apps.ts";

export const JSON_HEADERS = { "Access-Control-Allow-Origin": "*", "Content-Type": "application/json" };

// Who is calling, reduced to what the app routes need. Loopback is the box
// owner at a shell — full visibility, like an office owner, but with no user to
// own new registrations.
export type AppsIdentity = { scope: "agent"; agentId: string; userId: string | null } | { scope: "user"; userId: string; username: string; role: "owner" | "member" } | { scope: "loopback" };

// Registry and supervisor refusals -> HTTP. A 400 is "your request is wrong",
// a 409 is "the world says no", a 500 is "we failed". Kept as one exhaustive
// table so a new code cannot quietly default to 500.
const STATUS_BY_CODE: Record<AppErrorCode, number> = {
  invalid_name: 400,
  reserved_name: 400,
  invalid_command: 400,
  invalid_cwd: 400,
  invalid_description: 400,
  name_taken: 409,
  origin_retired: 409,
  no_label_available: 409,
  app_limit_reached: 409,
  no_port_available: 409,
  registry_corrupt: 500,
  persist_failed: 500,
  supervisor_failed: 500,
};

export function resolveAppsIdentity(req: Request, auth?: AuthResult): AppsIdentity | Response {
  const rawBearer = readBearerToken(req);
  const bearer = resolveAgentToken(rawBearer);
  // A malformed bearer token is refused rather than falling back to whatever
  // session cookie rode along with it.
  if (rawBearer && !bearer) return jsonError(401, "unauthenticated", "missing or invalid bearer token");
  if (bearer) return { scope: "agent", agentId: bearer.agentId, userId: bearer.userId };
  if (auth?.kind === "ok") return { scope: "user", userId: auth.session.userId, username: auth.session.username, role: auth.session.role };
  if (auth?.kind === "loopback") return { scope: "loopback" };
  return jsonError(401, "unauthenticated", "authentication required");
}

// Identity-derived attribution, following the task board's convention:
// createdBy is the caller's display identity (agent name, or the human's
// name), the owner is the caller's user — for an agent, its manager, so the
// app survives the agent.
export function appAttributionFor(identity: AppsIdentity): { userId: string | null; username: string | null; createdBy: string } {
  switch (identity.scope) {
    case "agent": {
      const display = AgentManager.getAgentDisplay(identity.agentId);
      const owner = identity.userId ? getUserById(identity.userId) : null;
      return { userId: identity.userId, username: owner?.name ?? null, createdBy: display?.name ?? identity.agentId };
    }
    case "user":
      return { userId: identity.userId, username: identity.username, createdBy: identity.username };
    case "loopback":
      return { userId: null, username: null, createdBy: "local" };
  }
}

// Office owners (and the box owner at a loopback shell) see every app;
// everyone else sees the apps their user owns. Mirrors the cronjob rule.
//
// A browser session carries its own role, so it is read from the session
// rather than looked up again. An agent's role is its MANAGER's, which only
// the users store knows — an agent with no manager is nobody's owner.
function seesAll(identity: AppsIdentity): boolean {
  switch (identity.scope) {
    case "loopback":
      return true;
    case "user":
      return identity.role === "owner";
    case "agent":
      return identity.userId !== null && getUserById(identity.userId)?.role === "owner";
  }
}

export function visibleApps(all: AppRecord[], identity: AppsIdentity): AppRecord[] {
  if (seesAll(identity)) return all;
  const userId = identity.scope === "loopback" ? null : identity.userId;
  return all.filter((a) => a.userId !== null && a.userId === userId);
}

// A record the caller may not see is reported as absent, not as forbidden: the
// existence of another user's app is not this caller's business either.
export function visibleApp(record: AppRecord | null, identity: AppsIdentity): AppRecord | null {
  if (!record) return null;
  return visibleApps([record], identity).length > 0 ? record : null;
}

// Announce, and never let the telling of it change what was told. Every
// announce call site sits AFTER its commit point; a throw from the broadcast
// would answer 500 for a register that really did register. The announcement
// is the LAST thing that happens and the least important: a socket that missed
// a frame re-converges on the Apps tab's next fetch, while a lie about whether
// the mutation happened does not heal.
export function announced(what: string, send: () => void): void {
  try {
    send();
  } catch (err) {
    console.error(`[apps] "${what}" changed but was not announced:`, err);
  }
}

// A registry or supervisor error carries the wire code; anything else is a
// genuine surprise and is re-thrown for the router to log and answer 500.
export function renderAppError(err: unknown): Response {
  if (err instanceof AppRegistryError || err instanceof AppSupervisorError) {
    return jsonError(STATUS_BY_CODE[err.code], err.code, err.message);
  }
  throw err;
}

export async function readAppJson(req: Request): Promise<Record<string, unknown> | null> {
  try {
    const body = await req.json();
    return body && typeof body === "object" && !Array.isArray(body) ? (body as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

export function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

export function jsonError(status: number, code: string, message: string): Response {
  return new Response(JSON.stringify({ error: { code, message } }), { status, headers: JSON_HEADERS });
}
