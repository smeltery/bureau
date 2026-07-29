import * as AgentManager from "../agent-manager.ts";
import { readBearerToken, resolveAgentToken } from "../agents/tokens.ts";
import type { AuthResult } from "../auth/auth-middleware.ts";
import { buildAgentsManifest } from "../persistence.ts";
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
