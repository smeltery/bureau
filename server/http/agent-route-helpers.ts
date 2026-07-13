import * as AgentManager from "../agent-manager.ts";
import type { AuthResult } from "../auth/auth-middleware.ts";
import { canSeeRoom, getUserById } from "../users.ts";
import type { UserRecord } from "../../shared/types.ts";

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

export function agentRouteParts(pathname: string): string[] | null {
  const parts = pathname.split("/").filter(Boolean);
  if (parts[0] === "agents") return parts;
  if (parts[0] === "api" && parts[1] === "agents") return parts.slice(1);
  return null;
}
