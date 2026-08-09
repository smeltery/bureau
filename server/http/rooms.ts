import type { AuthResult } from "../auth/auth-middleware.ts";
import * as AgentManager from "../agent-manager.ts";
import { readBearerToken, resolveAgentToken } from "../agents/tokens.ts";
import { privilegedAgentIdentity, type PrivilegedAgentIdentity } from "./agent-route-helpers.ts";
import { canSeeRoom, getUserById } from "../users.ts";
import { DESK_COUNT, isValidDesk } from "../../shared/desks.ts";
import { createHash } from "crypto";

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
  // A privileged agent is the one non-browser caller allowed past this gate: it
  // manages rooms with its MANAGER's authority (see privilegedAgentIdentity).
  // Every room decision below therefore asks about `operator.manager` when an
  // operator is present, and about the browser session otherwise.
  const operator = privilegedAgentIdentity(req);
  if (!operator && auth.kind !== "ok") return error(401, "authenticated browser session required");

  const roomId = parts[2];
  const action = parts[3];

  if (req.method === "POST" && !roomId) {
    if (!canCreateRoom(auth, operator)) return error(403, "owner access required");
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
    if (!canReadRoomSettings(req, auth, roomId, operator)) return error(403, "room access required");
    const settings = AgentManager.getRoomSettings(roomId);
    if (!settings) return error(404, "room not found");
    return new Response(JSON.stringify({ ...settings, version: roomSettingsVersion(settings) }), { headers: jsonHeaders });
  }

  // Single room-visibility gate covering close, rename, settings write, and
  // desk swaps. Room-SCOPED operations are limited to rooms the actor can see;
  // a privileged agent gets exactly its manager's `canSeeRoom` set, never more.
  if (!canManageRoom(auth, roomId, operator)) return error(403, "room access required");

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
    const current = AgentManager.getRoomSettings(roomId);
    if (!current) return error(404, "room not found");
    const version = typeof body.version === "string" ? body.version : "";
    if (!version) return error(400, "settings version is required");
    const currentVersion = roomSettingsVersion(current);
    if (version !== currentVersion) return error(409, "room settings changed; fetch the latest version and retry");
    if (!AgentManager.setRoomSettings(roomId, prompt, envFile)) return error(404, "room not found");
    return new Response(null, { status: 204, headers: noContentHeaders });
  }

  if (req.method === "POST" && action === "swap-desks") {
    const body = await readJson(req);
    if (body instanceof Response) return body;
    const deskA = Number(body.deskA);
    const deskB = Number(body.deskB);
    if (!isValidDesk(deskA) || !isValidDesk(deskB)) {
      return error(422, `deskA and deskB must be integers from 0 to ${DESK_COUNT - 1}`);
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

function roomSettingsVersion(settings: { prompt: string | null; envFile: string | null }): string {
  return createHash("sha256")
    .update(JSON.stringify({ prompt: settings.prompt ?? null, envFile: settings.envFile ?? null }))
    .digest("hex")
    .slice(0, 12);
}

function sessionCanSeeRoom(auth: AuthResult, roomId: string): boolean {
  if (auth.kind !== "ok") return false;
  if (auth.session.role === "owner") return true;
  return canSeeRoom(getUserById(auth.session.userId), roomId);
}

function canManageRoom(auth: AuthResult, roomId: string, operator: PrivilegedAgentIdentity | null): boolean {
  if (operator) return canSeeRoom(operator.manager, roomId);
  return sessionCanSeeRoom(auth, roomId);
}

// Room CREATE has no room to scope to, so it scopes to the actor's own standing
// instead. Bureau gates create on `role === "owner"` for humans, and a
// privileged agent must never hold more authority than the boss it acts for —
// so an owner's privileged agent may create rooms and a member's may not. This
// is deliberately stricter than upstream, which grants create office-wide to any
// room:manage holder; upstream has no owner-only create gate to stay behind.
function canCreateRoom(auth: AuthResult, operator: PrivilegedAgentIdentity | null): boolean {
  if (operator) return operator.manager.role === "owner";
  return auth.kind === "ok" && auth.session.role === "owner";
}

function canReadRoomSettings(req: Request, auth: AuthResult, roomId: string, operator: PrivilegedAgentIdentity | null): boolean {
  if (canManageRoom(auth, roomId, operator)) return true;
  // Unchanged baseline: ANY agent (privileged or not) may read the settings of
  // the room it actually sits in, so it can see the prompt it runs under.
  const identity = resolveAgentToken(readBearerToken(req));
  if (!identity) return false;
  const agent = AgentManager.getAgent(identity.agentId);
  if (!agent) return false;
  const room = AgentManager.getRooms()[agent.room];
  return room?.id === roomId;
}
