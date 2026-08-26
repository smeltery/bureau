import * as AgentManager from "../agent-manager.ts";
import { readBearerToken, resolveAgentToken } from "../agents/tokens.ts";
import type { AuthResult } from "../auth/auth-middleware.ts";
import { buildAgentsManifest, buildKilledManifest } from "../persistence.ts";
import { canSeeRoom, getUserById } from "../users.ts";
import { FAMILY_TO_MODEL, type AgentInfo, type UserRecord } from "../../shared/types.ts";

export const JSON_HEADERS = { "Access-Control-Allow-Origin": "*", "Content-Type": "application/json" };

export async function readJsonBody(req: Request): Promise<Record<string, unknown> | null> {
  try {
    const body = await req.json();
    return body && typeof body === "object" && !Array.isArray(body) ? (body as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

export function jsonError(status: number, error: string): Response {
  return new Response(JSON.stringify({ error }), { status, headers: JSON_HEADERS });
}

export function sessionUser(auth: AuthResult | undefined): UserRecord | null {
  if (auth?.kind !== "ok") return null;
  return getUserById(auth.session.userId);
}

export function requireUserAgentAccess(auth: AuthResult | undefined, agentId: string): Response | null {
  const agent = AgentManager.getAgent(agentId);
  if (!agent) return jsonError(404, "agent not found");
  if (auth?.kind === "loopback") return null;
  const user = sessionUser(auth);
  if (!user) return jsonError(401, "unauthenticated");
  const roomId = AgentManager.getRooms()[agent.room]?.id;
  if (!roomId || !canSeeRoom(user, roomId)) return jsonError(403, "forbidden");
  return null;
}

export interface PrivilegedAgentIdentity {
  agentId: string;
  /** The user who spawned the agent. A privileged agent borrows this person's office visibility and never more. */
  manager: UserRecord;
}

/**
 * Resolve a request's `Authorization: Bearer` header to a PRIVILEGED agent
 * identity, or null when the caller is anything else.
 *
 * This is the ONE place bureau turns the `privileged` token bit into real
 * server-side authority, so the rule lives here instead of being re-derived at
 * each route. Three conditions, all required:
 *
 *  1. the bearer token resolves (`resolveAgentToken`) — a garbage token gets
 *     nothing and simply falls back to the route's normal session rule;
 *  2. the token carries `privileged: true` — a normal agent token gets no
 *     office-management authority at all;
 *  3. the token names a manager user that STILL EXISTS. A privileged agent acts
 *     with its manager's room visibility, so an agent with no manager
 *     (`userId: null` — pre-multi-user records, or an agent whose boss was
 *     deleted) is refused outright. The `!manager` line is the load-bearing one
 *     and must not be relaxed into a fallback: `canSeeRoom(null, roomId)`
 *     returns `true` for the no-user case, so letting a missing manager through
 *     would hand a stale token office-wide access while the room check that
 *     looks like the boundary approved it. (The `!identity.userId` clause is a
 *     fast path rather than a second boundary — `getUserById(null)` matches no
 *     record — but it states the intent where a reader meets it.) Both are
 *     pinned by tests that fail on removal, in
 *     server/http/__tests__/agent-route-helpers.test.ts.
 *
 * Callers pair it with `canSeeRoom(identity.manager, roomId)` — see
 * `requireAgentAccessAllowingPrivileged` and
 * `requireRoomAccessAllowingPrivileged` below — which keeps a privileged agent
 * inside exactly the rooms its boss can see.
 *
 * Deliberately NOT consulted by office settings and external access, invites,
 * browser sessions, user records, view preferences, the terminal, or the
 * privileged toggle itself. Those exclusions come from the upstream audit this
 * follows: they either mint durable human logins, kill a human's browser
 * session, or hand the agent the ability to widen its own authority. Each of
 * those handlers carries a comment saying so — read it before relaxing one.
 */
export function privilegedAgentIdentity(req: Request): PrivilegedAgentIdentity | null {
  const identity = resolveAgentToken(readBearerToken(req));
  if (!identity || !identity.privileged || !identity.userId) return null;
  const manager = getUserById(identity.userId);
  if (!manager) return null;
  return { agentId: identity.agentId, manager };
}

/**
 * Agent-scoped gate for the office-management routes a privileged agent may
 * drive (spawn / kill / edit / move / topic / resume / new-conversation /
 * send-now / dequeue). Mirrors `requireUserAgentAccess`'s visibility rule
 * exactly — agent must exist, and its room must be visible — with the
 * privileged agent's MANAGER substituted for the browser session's user. Any
 * other caller falls through to the unchanged session rule.
 *
 * The privileged branch is checked FIRST and does not fall back. That matters
 * because bureau's HTTP auth allows loopback on these routes (see router.ts:
 * `authenticate(..., { allowLoopback: true })`), which `requireUserAgentAccess`
 * accepts outright — so a same-box caller is already trusted here. Taking the
 * privileged branch therefore makes a privileged agent's reach NARROWER, not
 * wider: it is held to its manager's room visibility rather than to
 * "runs on this machine". Keep it that way; a privileged agent is the one local
 * caller whose scope we can actually name, and it is the caller we most want
 * scoped. It also means these gates keep working if the loopback trust is ever
 * tightened.
 */
export function requireAgentAccessAllowingPrivileged(req: Request, auth: AuthResult | undefined, agentId: string): Response | null {
  const operator = privilegedAgentIdentity(req);
  if (!operator) return requireUserAgentAccess(auth, agentId);
  const agent = AgentManager.getAgent(agentId);
  if (!agent) return jsonError(404, "agent not found");
  const roomId = AgentManager.getRooms()[agent.room]?.id;
  if (!roomId || !canSeeRoom(operator.manager, roomId)) return jsonError(403, "forbidden");
  return null;
}

/** Self-handoff via bearer, or operator/privileged steering with the same visibility rules as new-conversation. */
export function requireHandoffAccess(req: Request, auth: AuthResult | undefined, agentId: string): Response | null {
  const rawBearer = readBearerToken(req);
  const bearer = resolveAgentToken(rawBearer);
  if (rawBearer && !bearer) return jsonError(401, "missing or invalid bearer token");
  if (bearer?.agentId === agentId) return null;
  if (privilegedAgentIdentity(req)) return requireAgentAccessAllowingPrivileged(req, auth, agentId);
  if (bearer) return jsonError(403, "forbidden");
  return requireAgentAccessAllowingPrivileged(req, auth, agentId);
}

/** Room-scoped sibling of the above, for routes that name a target room in the body (spawn, revive-style moves). */
export function requireRoomAccessAllowingPrivileged(req: Request, auth: AuthResult | undefined, roomId: string): Response | null {
  const operator = privilegedAgentIdentity(req);
  if (!operator) return requireUserRoomAccess(auth, roomId);
  if (!canSeeRoom(operator.manager, roomId)) return jsonError(403, "forbidden");
  return null;
}

export function requireUserSession(auth: AuthResult | undefined): Response | null {
  if (auth?.kind === "ok") return null;
  return jsonError(401, "unauthenticated");
}

export function requireUserRoomAccess(auth: AuthResult | undefined, roomId: string): Response | null {
  const denied = requireUserSession(auth);
  if (denied) return denied;
  const user = sessionUser(auth);
  if (!user || !canSeeRoom(user, roomId)) return jsonError(403, "forbidden");
  return null;
}

export function requireOwnerAgentAccess(auth: AuthResult | undefined, agentId: string): Response | null {
  const denied = requireUserAgentAccess(auth, agentId);
  if (denied) return denied;
  const user = sessionUser(auth);
  if (!user || user.role !== "owner") return jsonError(403, "owner access required");
  return null;
}

export function requireAgentManagerAccess(auth: AuthResult | undefined, agentId: string): Response | null {
  const denied = requireUserAgentAccess(auth, agentId);
  if (denied) return denied;
  const user = sessionUser(auth);
  const agent = AgentManager.getAgent(agentId);
  if (!user || !agent) return jsonError(404, "agent not found");
  if (user.role === "owner" || agent.userId === user.id) return null;
  return jsonError(403, "owner or manager access required");
}

export function projectedAgentsManifest(req: Request, auth: AuthResult | undefined): Response | unknown[] {
  const rawBearer = readBearerToken(req);
  const bearer = resolveAgentToken(rawBearer);
  if (rawBearer && !bearer) return jsonError(401, "missing or invalid bearer token");

  if (new URL(req.url).searchParams.get("killed") === "1") {
    if (bearer) {
      if (!bearer.userId) return jsonError(403, "forbidden");
      return buildKilledManifest(AgentManager.getKilledAgentSummariesForManager(bearer.userId));
    }
    if (auth?.kind === "loopback" || (auth?.kind === "ok" && auth.session.role === "owner")) {
      return buildKilledManifest(AgentManager.getKilledAgentSummaries());
    }
    const user = sessionUser(auth);
    if (!user) return jsonError(401, "unauthenticated");
    return buildKilledManifest(AgentManager.getKilledAgentSummariesForManager(user.id));
  }

  const rooms = AgentManager.getRooms();
  let agents: AgentInfo[];
  if (bearer) {
    const user = bearer.userId ? getUserById(bearer.userId) : null;
    agents = user ? projectAgentsForUser(user, rooms) : AgentManager.getAllAgents().filter((agent) => agent.id === bearer.agentId);
  } else if (auth?.kind === "loopback") {
    agents = AgentManager.getAllAgents();
  } else if (auth?.kind === "ok" && auth.session.role === "owner") {
    agents = AgentManager.getAllAgents();
  } else {
    const user = sessionUser(auth);
    if (!user) return jsonError(401, "unauthenticated");
    agents = projectAgentsForUser(user, rooms);
  }

  return buildAgentsManifest(
    agents.map((agent) => {
      const room = rooms[agent.room];
      return {
        id: agent.id,
        name: agent.name,
        userId: agent.userId ?? null,
        managerName: agent.userId ? (getUserById(agent.userId)?.name ?? null) : null,
        privileged: agent.privileged ?? false,
        desk: agent.desk,
        room: agent.room,
        roomId: room?.id ?? agent.roomId ?? "",
        roomName: room?.name ?? `Room ${agent.room + 1}`,
        topic: agent.topic,
        cwd: agent.cwd,
        agentType: agent.agentType,
        capabilities: agent.capabilities,
        modelFamily: agent.modelFamily,
        model: FAMILY_TO_MODEL[agent.modelFamily as keyof typeof FAMILY_TO_MODEL] ?? agent.modelFamily,
        effort: agent.effort,
        inFlightTurn: AgentManager.getAgentInFlightTurnForManifest(agent.id),
        pendingPrompt: agent.pendingPrompt ?? null,
        lastSessionId: AgentManager.getCurrentSessionId(agent.id),
      };
    }),
  );
}

function projectAgentsForUser(user: UserRecord, rooms: ReturnType<typeof AgentManager.getRooms>): AgentInfo[] {
  if (user.role === "owner") return AgentManager.getAllAgents();
  const visibleRoomIds = new Set(rooms.filter((room) => canSeeRoom(user, room.id)).map((room) => room.id));
  return AgentManager.getAllAgents().filter((agent) => {
    const roomId = rooms[agent.room]?.id ?? agent.roomId;
    return !!roomId && visibleRoomIds.has(roomId);
  });
}

export function agentRouteParts(pathname: string): string[] | null {
  const parts = pathname.split("/").filter(Boolean);
  if (parts[0] === "agents") return parts;
  if (parts[0] === "api" && parts[1] === "agents") return parts.slice(1);
  return null;
}
