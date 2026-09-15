import * as AgentManager from "../agent-manager.ts";
import { AgentEditConflictError } from "../agents/settings.ts";
import { agents } from "../agents/state.ts";
import { refreshSubscriptionUsage } from "../backends/subscription-usage.ts";
import type { AuthResult } from "../auth/auth-middleware.ts";
import { saveRecentCwd } from "../persistence.ts";
import type { AgentInfo } from "../../shared/types.ts";
import { resolveInteractiveModelSelection } from "../agent-validators.ts";
import {
  JSON_HEADERS,
  jsonError,
  readJsonBody,
  requireAgentAccessAllowingPrivileged,
  requireAgentManagerAccess,
  requireRoomAccessAllowingPrivileged,
  requireUserAgentAccess,
  requireUserRoomAccess,
} from "./agent-route-helpers.ts";

export async function handleAgentManagementRequest(req: Request, parts: string[], agentId: string, auth?: AuthResult): Promise<Response | null> {
  // Agent lifecycle — kill / edit / move / topic — is what a privileged agent's
  // "manage the office" authority means, so these four accept a privileged
  // agent token scoped to the agents its manager can see. Everything else in
  // this file (revive, abort, subscription usage, session listing) stays
  // browser-session-only until there's a reason to widen it.
  if (req.method === "DELETE" && parts.length === 2) {
    const denied = requireAgentAccessAllowingPrivileged(req, auth, agentId);
    if (denied) return denied;
    await AgentManager.kill(agentId);
    return new Response(null, { status: 204, headers: JSON_HEADERS });
  }

  if (req.method === "PATCH" && parts.length === 2) {
    const denied = requireAgentAccessAllowingPrivileged(req, auth, agentId);
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
    const current = AgentManager.getAgent(agentId);
    if (!current) return jsonError(404, "agent not found");
    const agentType = body.agentType === "claude" || body.agentType === "codex" || body.agentType === "opencode" ? body.agentType : current.agentType;
    const modelSelection = resolveInteractiveModelSelection(agentType, typeof body.modelFamily === "string" ? body.modelFamily : undefined, typeof body.model === "string" ? body.model : undefined);
    if (modelSelection.error) return jsonError(422, modelSelection.error);
    try {
      await AgentManager.editAgent(agentId, {
        name: typeof body.name === "string" ? body.name : undefined,
        cwd,
        outfit: typeof body.outfit === "object" && body.outfit !== null && !Array.isArray(body.outfit) ? (body.outfit as AgentInfo["outfit"]) : undefined,
        customInstructions: typeof body.customInstructions === "string" ? body.customInstructions : undefined,
        customInstructionsVersion: typeof body.customInstructionsVersion === "string" ? body.customInstructionsVersion : undefined,
        agentType: body.agentType === "claude" || body.agentType === "codex" || body.agentType === "opencode" ? body.agentType : undefined,
        modelFamily: modelSelection.modelFamily,
        permissionMode: typeof body.permissionMode === "string" ? (body.permissionMode as AgentInfo["permissionMode"]) : undefined,
        codexSandbox: typeof body.codexSandbox === "string" ? (body.codexSandbox as AgentInfo["codexSandbox"]) : undefined,
        effort: typeof body.effort === "string" ? (body.effort as AgentInfo["effort"]) : undefined,
      });
    } catch (err) {
      if (err instanceof AgentEditConflictError) return jsonError(err.status, err.message);
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

  // OUT OF SCOPE for privileged agents, deliberately and permanently: the
  // privilege toggle itself. `requireAgentManagerAccess` demands a browser
  // session whose user owns the agent (or an owner), and it is never given a
  // `privilegedAgentIdentity` path — so no agent, privileged or not, can flip
  // the flag on itself or on any other agent. Nothing else in bureau writes
  // `privileged` from a request: `editAgent` (PATCH above) has no such field,
  // and the WS twin `set_agent_privileged` is browser-session-only. If you add
  // another writer, gate it exactly like this one.
  if (req.method === "PUT" && parts.length === 3 && parts[2] === "privileged") {
    const denied = requireAgentManagerAccess(auth, agentId);
    if (denied) return denied;
    const body = await readJsonBody(req);
    if (!body || typeof body.privileged !== "boolean") return jsonError(422, "privileged is required");
    const agent = await AgentManager.setAgentPrivileged(agentId, body.privileged);
    if (!agent) return jsonError(404, "agent not found");
    return new Response(JSON.stringify({ agent }), { headers: JSON_HEADERS });
  }

  if (req.method === "POST" && parts.length === 3 && parts[2] === "move") {
    const denied = requireAgentAccessAllowingPrivileged(req, auth, agentId);
    if (denied) return denied;
    const body = await readJsonBody(req);
    const targetRoomId = typeof body?.targetRoomId === "string" ? body.targetRoomId : "";
    if (!targetRoomId) return jsonError(422, "targetRoomId is required");
    // Both ends are checked: the agent's current room AND the destination must
    // be visible to the actor, so a move can never smuggle an agent into a room
    // the caller cannot see.
    const roomDenied = requireRoomAccessAllowingPrivileged(req, auth, targetRoomId);
    if (roomDenied) return roomDenied;
    if (!AgentManager.moveAgent(agentId, targetRoomId)) return jsonError(409, "agent could not be moved");
    const agent = AgentManager.getAgent(agentId);
    if (!agent) return jsonError(404, "agent not found");
    return new Response(JSON.stringify({ agent }), { headers: JSON_HEADERS });
  }

  if (req.method === "PUT" && parts.length === 3 && parts[2] === "topic") {
    const denied = requireAgentAccessAllowingPrivileged(req, auth, agentId);
    if (denied) return denied;
    const body = await readJsonBody(req);
    const topic = typeof body?.topic === "string" ? body.topic : null;
    if (topic === null) return jsonError(422, "topic is required");
    AgentManager.setTopic(agentId, topic);
    return new Response(null, { status: 204, headers: JSON_HEADERS });
  }

  if (req.method === "DELETE" && parts.length === 3 && parts[2] === "topic") {
    const denied = requireAgentAccessAllowingPrivileged(req, auth, agentId);
    if (denied) return denied;
    AgentManager.resetTopic(agentId);
    return new Response(null, { status: 204, headers: JSON_HEADERS });
  }

  // The account-scoped plan allowance behind the header's usage pill. PULLED
  // rather than pushed: the value describes the provider account rather than
  // this conversation, the backends police their own cost (Claude throttles its
  // control RPC, Codex reads rate limits its app-server already pushed), and the
  // committed reading lives on the ManagedAgent so it survives /clear, fork and
  // same-engine resume. `usage: null` is the honest "nothing to show" answer —
  // the pill renders its unknown state rather than disappearing.
  if (req.method === "GET" && parts.length === 3 && parts[2] === "subscription-usage") {
    const denied = requireUserAgentAccess(auth, agentId);
    if (denied) return denied;
    const usage = await refreshSubscriptionUsage(agents.get(agentId));
    return new Response(JSON.stringify({ usage }), { headers: JSON_HEADERS });
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
