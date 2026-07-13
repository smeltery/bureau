import * as AgentManager from "../agent-manager.ts";
import type { AuthResult } from "../auth/auth-middleware.ts";
import { saveRecentCwd } from "../persistence.ts";
import type { AgentBackendType, AgentInfo } from "../../shared/types.ts";
import { JSON_HEADERS, jsonError, readJsonBody, requireUserRoomAccess, requireUserSession } from "./agent-route-helpers.ts";

export async function handleAgentSpawnRequest(req: Request, auth?: AuthResult): Promise<Response> {
  const denied = requireUserSession(auth);
  if (denied) return denied;
  const body = await readJsonBody(req);
  if (!body) return jsonError(400, "invalid JSON body");
  const name = typeof body.name === "string" ? body.name.trim() : "";
  const cwd = typeof body.cwd === "string" ? body.cwd : "";
  const roomId = typeof body.roomId === "string" ? body.roomId : "";
  const desk = typeof body.desk === "number" ? body.desk : undefined;
  if (!name) return jsonError(422, "name is required");
  if (!cwd) return jsonError(422, "cwd is required");
  if (!roomId) return jsonError(422, "roomId is required");
  if (desk === undefined) return jsonError(422, "desk is required");
  const roomDenied = requireUserRoomAccess(auth, roomId);
  if (roomDenied) return roomDenied;
  try {
    AgentManager.validateCwd(cwd);
  } catch (err) {
    return jsonError(422, err instanceof Error ? err.message : "invalid directory");
  }
  saveRecentCwd(cwd);
  const agentType = parseAgentType(body.agentType) ?? "claude";
  const agent = await AgentManager.spawn(
    name,
    cwd,
    (body.permissionMode as AgentInfo["permissionMode"] | undefined) ?? "default",
    desk,
    typeof body.customInstructions === "string" ? body.customInstructions : undefined,
    roomId,
    typeof body.outfit === "object" && body.outfit !== null && !Array.isArray(body.outfit) ? (body.outfit as AgentInfo["outfit"]) : undefined,
    typeof body.modelFamily === "string" ? body.modelFamily : undefined,
    agentType,
    typeof body.codexSandbox === "string" ? (body.codexSandbox as AgentInfo["codexSandbox"]) : undefined,
    typeof body.effort === "string" ? (body.effort as AgentInfo["effort"]) : undefined,
    auth?.kind === "ok" ? auth.session.userId : null,
  );
  if (!agent) return jsonError(409, "agent name is taken or desk is unavailable");
  return new Response(JSON.stringify({ agent }), { status: 201, headers: JSON_HEADERS });
}

function parseAgentType(value: unknown): AgentBackendType | null {
  return value === "claude" || value === "codex" ? value : null;
}
