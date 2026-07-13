import * as AgentManager from "../agent-manager.ts";
import type { AuthResult } from "../auth/auth-middleware.ts";
import { saveRecentCwd } from "../persistence.ts";
import type { AgentInfo } from "../../shared/types.ts";
import { JSON_HEADERS, jsonError, readJsonBody, requireOwnerAgentAccess, requireUserAgentAccess, requireUserRoomAccess } from "./agent-route-helpers.ts";

export async function handleAgentManagementRequest(req: Request, parts: string[], agentId: string, auth?: AuthResult): Promise<Response | null> {
  if (req.method === "DELETE" && parts.length === 2) {
    const denied = requireUserAgentAccess(auth, agentId);
    if (denied) return denied;
    await AgentManager.kill(agentId);
    return new Response(null, { status: 204, headers: JSON_HEADERS });
  }

  if (req.method === "PATCH" && parts.length === 2) {
    const denied = requireUserAgentAccess(auth, agentId);
    if (denied) return denied;
    const body = await readJsonBody(req);
    if (!body) return jsonError(400, "invalid JSON body");
    const cwd = typeof body.cwd === "string" ? body.cwd : undefined;
    if (cwd) {
      try {
        AgentManager.validateCwd(cwd);
      } catch (err) {
        return jsonError(422, err instanceof Error ? err.message : "invalid directory");
      }
      saveRecentCwd(cwd);
    }
    try {
      await AgentManager.editAgent(agentId, {
        name: typeof body.name === "string" ? body.name : undefined,
        cwd,
        outfit: typeof body.outfit === "object" && body.outfit !== null && !Array.isArray(body.outfit) ? (body.outfit as AgentInfo["outfit"]) : undefined,
        customInstructions: typeof body.customInstructions === "string" ? body.customInstructions : undefined,
        modelFamily: typeof body.modelFamily === "string" ? body.modelFamily : undefined,
        permissionMode: typeof body.permissionMode === "string" ? (body.permissionMode as AgentInfo["permissionMode"]) : undefined,
        codexSandbox: typeof body.codexSandbox === "string" ? (body.codexSandbox as AgentInfo["codexSandbox"]) : undefined,
        effort: typeof body.effort === "string" ? (body.effort as AgentInfo["effort"]) : undefined,
      });
    } catch (err) {
      return jsonError(422, err instanceof Error ? err.message : "agent update failed");
    }
    const agent = AgentManager.getAgent(agentId);
    if (!agent) return jsonError(404, "agent not found");
    return new Response(JSON.stringify({ agent }), { headers: JSON_HEADERS });
  }

  if (req.method === "POST" && parts.length === 3 && parts[2] === "revive") {
    const body = await readJsonBody(req);
    if (!body) return jsonError(400, "invalid JSON body");
    const roomId = typeof body.roomId === "string" ? body.roomId : "";
    const desk = typeof body.desk === "number" ? body.desk : undefined;
    if (!roomId) return jsonError(422, "roomId is required");
    if (desk === undefined) return jsonError(422, "desk is required");
    const denied = requireUserRoomAccess(auth, roomId);
    if (denied) return denied;
    const result = await AgentManager.revive(agentId, roomId, desk);
    if (!result.ok) return jsonError(422, result.error);
    return new Response(JSON.stringify({ agent: result.agent }), { status: 201, headers: JSON_HEADERS });
  }

  if (req.method === "POST" && parts.length === 3 && parts[2] === "abort") {
    const denied = requireUserAgentAccess(auth, agentId);
    if (denied) return denied;
    await AgentManager.abort(agentId);
    return new Response(null, { status: 204, headers: JSON_HEADERS });
  }

  if (req.method === "PUT" && parts.length === 3 && parts[2] === "privileged") {
    const denied = requireOwnerAgentAccess(auth, agentId);
    if (denied) return denied;
    const body = await readJsonBody(req);
    if (!body || typeof body.privileged !== "boolean") return jsonError(422, "privileged is required");
    const agent = await AgentManager.setAgentPrivileged(agentId, body.privileged);
    if (!agent) return jsonError(404, "agent not found");
    return new Response(JSON.stringify({ agent }), { headers: JSON_HEADERS });
  }

  if (req.method === "POST" && parts.length === 3 && parts[2] === "move") {
    const denied = requireUserAgentAccess(auth, agentId);
    if (denied) return denied;
    const body = await readJsonBody(req);
    const targetRoomId = typeof body?.targetRoomId === "string" ? body.targetRoomId : "";
    if (!targetRoomId) return jsonError(422, "targetRoomId is required");
    const roomDenied = requireUserRoomAccess(auth, targetRoomId);
    if (roomDenied) return roomDenied;
    if (!AgentManager.moveAgent(agentId, targetRoomId)) return jsonError(409, "agent could not be moved");
    const agent = AgentManager.getAgent(agentId);
    if (!agent) return jsonError(404, "agent not found");
    return new Response(JSON.stringify({ agent }), { headers: JSON_HEADERS });
  }

  if (req.method === "PUT" && parts.length === 3 && parts[2] === "topic") {
    const denied = requireUserAgentAccess(auth, agentId);
    if (denied) return denied;
    const body = await readJsonBody(req);
    const topic = typeof body?.topic === "string" ? body.topic : null;
    if (topic === null) return jsonError(422, "topic is required");
    AgentManager.setTopic(agentId, topic);
    return new Response(null, { status: 204, headers: JSON_HEADERS });
  }

  if (req.method === "DELETE" && parts.length === 3 && parts[2] === "topic") {
    const denied = requireUserAgentAccess(auth, agentId);
    if (denied) return denied;
    AgentManager.resetTopic(agentId);
    return new Response(null, { status: 204, headers: JSON_HEADERS });
  }

  if (req.method === "GET" && parts.length === 3 && parts[2] === "sessions") {
    const denied = requireUserAgentAccess(auth, agentId);
    if (denied) return denied;
    return new Response(
      JSON.stringify({
        sessions: AgentManager.listSessions(agentId),
        currentSessionId: AgentManager.getCurrentSessionId(agentId),
      }),
      { headers: JSON_HEADERS },
    );
  }

  return null;
}
