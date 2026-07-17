import type { AuthResult } from "../auth/auth-middleware.ts";
import * as AgentManager from "../agent-manager.ts";
import { readBearerToken, resolveAgentToken } from "../agents/tokens.ts";
import { canSeeRoom, getUserById } from "../users.ts";

const jsonHeaders = { "Access-Control-Allow-Origin": "*", "Content-Type": "application/json" };
const noContentHeaders = { "Access-Control-Allow-Origin": "*" };

export async function handleRoomsRequest(req: Request, url: URL, auth: AuthResult, opts: { pushPresence?: () => void } = {}): Promise<Response | null> {
  if (req.method === "OPTIONS" && url.pathname.startsWith("/api/rooms")) {
    return new Response(null, {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, POST, PATCH, PUT, DELETE, OPTIONS",
        "Access-Control-Allow-Headers": "Authorization, Content-Type",
      },
    });
  }

  const parts = url.pathname.split("/").filter(Boolean);
  if (parts[0] !== "api" || parts[1] !== "rooms") return null;
  if (auth.kind !== "ok") return error(401, "authenticated browser session required");

  const roomId = parts[2];
  const action = parts[3];

  if (req.method === "POST" && !roomId) {
    if (auth.session.role !== "owner") return error(403, "owner access required");
    const body = await readJson(req);
    if (body instanceof Response) return body;
    const name = typeof body.name === "string" ? body.name : undefined;
    const id = AgentManager.createRoom(name);
    opts.pushPresence?.();
    const room = AgentManager.getRooms().find((r) => r.id === id);
    return new Response(JSON.stringify({ room }), { status: 201, headers: jsonHeaders });
  }

  if (!roomId) return error(404, "not found");

  if (req.method === "GET" && action === "settings") {
    if (!canReadRoomSettings(req, auth, roomId)) return error(403, "room access required");
    const settings = AgentManager.getRoomSettings(roomId);
    if (!settings) return error(404, "room not found");
    return new Response(JSON.stringify(settings), { headers: jsonHeaders });
  }

  if (!sessionCanSeeRoom(auth, roomId)) return error(403, "room access required");

  if (req.method === "DELETE" && !action) {
    const ok = AgentManager.closeRoom(roomId);
    if (!ok) return error(404, "room not found or not empty");
    opts.pushPresence?.();
    return new Response(null, { status: 204, headers: noContentHeaders });
  }

  if (req.method === "PATCH" && !action) {
    const body = await readJson(req);
    if (body instanceof Response) return body;
    const name = typeof body.name === "string" ? body.name.trim() : "";
    if (!name) return error(422, "name is required");
    if (!AgentManager.renameRoom(roomId, name)) return error(404, "room not found");
    return new Response(null, { status: 204, headers: noContentHeaders });
  }

  if (req.method === "PUT" && action === "settings") {
    const body = await readJson(req);
    if (body instanceof Response) return body;
    const prompt = typeof body.prompt === "string" ? body.prompt : null;
    const envFile = typeof body.envFile === "string" && body.envFile.trim() ? body.envFile.trim() : null;
    if (envFile) {
      try {
        AgentManager.validateEnvPath(envFile);
      } catch (err) {
        return error(422, err instanceof Error ? err.message : "invalid env file");
      }
    }
    if (!AgentManager.setRoomSettings(roomId, prompt, envFile)) return error(404, "room not found");
    return new Response(null, { status: 204, headers: noContentHeaders });
  }

  if (req.method === "POST" && action === "swap-desks") {
    const body = await readJson(req);
    if (body instanceof Response) return body;
    const deskA = Number(body.deskA);
    const deskB = Number(body.deskB);
    if (!Number.isInteger(deskA) || !Number.isInteger(deskB) || deskA < 0 || deskA > 7 || deskB < 0 || deskB > 7) {
      return error(422, "deskA and deskB must be integers from 0 to 7");
    }
    AgentManager.swapDesks(deskA, deskB, roomId);
    return new Response(null, { status: 204, headers: noContentHeaders });
  }

  return error(404, "not found");
}

async function readJson(req: Request): Promise<Record<string, unknown> | Response> {
  try {
    return (await req.json()) as Record<string, unknown>;
  } catch {
    return error(400, "invalid JSON");
  }
}

function error(status: number, message: string): Response {
  return new Response(JSON.stringify({ error: message }), { status, headers: jsonHeaders });
}

function sessionCanSeeRoom(auth: AuthResult, roomId: string): boolean {
  if (auth.kind !== "ok") return false;
  if (auth.session.role === "owner") return true;
  return canSeeRoom(getUserById(auth.session.userId), roomId);
}

function canReadRoomSettings(req: Request, auth: AuthResult, roomId: string): boolean {
  if (sessionCanSeeRoom(auth, roomId)) return true;
  const identity = resolveAgentToken(readBearerToken(req));
  if (!identity) return false;
  const agent = AgentManager.getAgent(identity.agentId);
  if (!agent) return false;
  const room = AgentManager.getRooms()[agent.room];
  return room?.id === roomId;
}
