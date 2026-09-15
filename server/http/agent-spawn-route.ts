import * as AgentManager from "../agent-manager.ts";
import type { AuthResult } from "../auth/auth-middleware.ts";
import { saveRecentCwd } from "../persistence.ts";
import type { AgentBackendType, AgentInfo } from "../../shared/types.ts";
import { DESK_COUNT, isValidDesk } from "../../shared/desks.ts";
import { JSON_HEADERS, jsonError, privilegedAgentIdentity, readJsonBody, requireRoomAccessAllowingPrivileged, requireUserSession } from "./agent-route-helpers.ts";
import { resolveInteractiveModelSelection } from "../agent-validators.ts";

export async function handleAgentSpawnRequest(req: Request, auth?: AuthResult): Promise<Response> {
  // A privileged agent may hire a coworker on its boss's behalf: the new agent
  // is attributed to the SAME manager, and the target room still has to be one
  // that manager can see (checked below), so the agent cannot seed a room it is
  // not allowed into. Every other caller needs a browser session as before.
  const operator = privilegedAgentIdentity(req);
  if (!operator) {
    const denied = requireUserSession(auth);
    if (denied) return denied;
  }
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
  if (!isValidDesk(desk)) return jsonError(422, `desk must be an integer from 0 to ${DESK_COUNT - 1}`);
  const roomDenied = requireRoomAccessAllowingPrivileged(req, auth, roomId);
  if (roomDenied) return roomDenied;
  try {
    AgentManager.validateCwd(cwd);
  } catch (err) {
    return jsonError(422, err instanceof Error ? err.message : "invalid directory");
  }
  saveRecentCwd(cwd);
  const agentType = parseAgentType(body.agentType) ?? "claude";
  const modelSelection = resolveInteractiveModelSelection(agentType, typeof body.modelFamily === "string" ? body.modelFamily : undefined, typeof body.model === "string" ? body.model : undefined);
  if (modelSelection.error) return jsonError(422, modelSelection.error);
  const agent = await AgentManager.spawn(
    name,
    cwd,
    (body.permissionMode as AgentInfo["permissionMode"] | undefined) ?? "default",
    desk,
    typeof body.customInstructions === "string" ? body.customInstructions : undefined,
    roomId,
    typeof body.outfit === "object" && body.outfit !== null && !Array.isArray(body.outfit) ? (body.outfit as AgentInfo["outfit"]) : undefined,
    modelSelection.modelFamily,
    agentType,
    typeof body.codexSandbox === "string" ? (body.codexSandbox as AgentInfo["codexSandbox"]) : undefined,
    typeof body.effort === "string" ? (body.effort as AgentInfo["effort"]) : undefined,
    operator ? operator.manager.id : auth?.kind === "ok" ? auth.session.userId : null,
  );
  if (!agent) return jsonError(409, "agent name is taken or desk is unavailable");
  return new Response(JSON.stringify({ agent }), { status: 201, headers: JSON_HEADERS });
}

function parseAgentType(value: unknown): AgentBackendType | null {
  return value === "claude" || value === "codex" || value === "opencode" ? value : null;
}
