import * as AgentManager from "../agent-manager.ts";
import { readBearerToken, resolveAgentToken } from "../agents/tokens.ts";
import type { AuthResult } from "../auth/auth-middleware.ts";
import type { Attachment } from "../../shared/types.ts";
import { handleAgentBearerPost } from "./agent-bearer-routes.ts";
import { handleAgentManagementRequest } from "./agent-management-routes.ts";
import { handleAgentSpawnRequest } from "./agent-spawn-route.ts";
import { agentRouteParts, JSON_HEADERS, jsonError, readJsonBody, requireUserAgentAccess, sessionUser } from "./agent-route-helpers.ts";

/**
 * Handle agent-scoped HTTP routes:
 *   POST /api/agents                     — spawn an agent.
 *   DELETE /api/agents/:id               — kill an agent.
 *   PATCH /api/agents/:id                — edit agent metadata/session settings.
 *   POST /api/agents/:id/revive          — revive a killed agent.
 *   POST /api/agents/:id/abort           — abort the active agent run.
 *   PUT  /api/agents/:id/privileged      — toggle privileged agent tokens.
 *   POST /api/agents/:id/move            — move an agent to another room.
 *   PUT  /api/agents/:id/topic           — set an agent topic.
 *   DELETE /api/agents/:id/topic         — reset an agent topic.
 *   POST /api/agents/:id/diff             — emit a styled diff card (optional body: { dir, commit }).
 *   POST /api/agents/:id/edit-file        — emit an [Open in editor] card (body: { path }).
 *   POST /api/agents/:id/read-file        — copy a file into the agent's files dir and
 *                                           emit a `file-view` card (body: { path }).
 *   POST /api/agents/:id/terminal-command — emit a [Copy to terminal] card (body: { command }).
 *   POST /api/agents/:id/message          — queue an agent-to-agent message into the
 *                                           receiver's chat (body: { text, senderAgentId }).
 *   POST /api/agents/:id/messages         — send a user or bearer agent message.
 *   PATCH /api/agents/:id/messages/:entry — edit a prior user message.
 *   GET  /api/agents/:id/sessions         — list resumable sessions.
 *   POST /api/agents/:id/resume           — resume a session.
 *   POST /api/agents/:id/new-conversation — start a fresh session.
 *   POST /api/agents/:id/send-now         — flush queued messages.
 *   DELETE /api/agents/:id/queue/:msg     — drop a queued message.
 *
 * Legacy /agents/:id/... aliases stay accepted for older agent prompts.
 *
 * Returns null for any other URL so the caller can fall through.
 */
export async function handleAgentsRequest(req: Request, url: URL, auth?: AuthResult): Promise<Response | null> {
  const parts = agentRouteParts(url.pathname);
  if (!parts) return null;

  if (parts[0] === "agents" && parts.length === 1 && req.method === "POST") {
    return handleAgentSpawnRequest(req, auth);
  }

  if (parts[0] === "agents" && parts.length >= 2) {
    const agentId = parts[1]!;
    const managementResponse = await handleAgentManagementRequest(req, parts, agentId, auth);
    if (managementResponse) return managementResponse;

    if (req.method === "PATCH" && parts.length === 4 && parts[2] === "messages") {
      const denied = requireUserAgentAccess(auth, agentId);
      if (denied) return denied;
      const body = await readJsonBody(req);
      const newText = typeof body?.newText === "string" ? body.newText : "";
      if (!newText) return jsonError(422, "newText is required");
      const username = sessionUser(auth)?.name;
      void AgentManager.editMessage(agentId, parts[3]!, newText, username);
      return new Response(JSON.stringify({ messageId: "" }), { headers: JSON_HEADERS });
    }

    if (req.method === "DELETE" && parts.length === 4 && parts[2] === "queue") {
      const denied = requireUserAgentAccess(auth, agentId);
      if (denied) return denied;
      AgentManager.dequeueMessage(agentId, parts[3]!);
      return new Response(null, { status: 204, headers: JSON_HEADERS });
    }

    if (req.method === "POST" && parts.length === 3 && parts[2] === "messages") {
      const body = await readJsonBody(req);
      const text = typeof body?.text === "string" ? body.text : "";
      if (!text && !Array.isArray(body?.attachments)) return jsonError(400, "text is required");
      const rawBearer = readBearerToken(req);
      const bearer = resolveAgentToken(rawBearer);
      if (rawBearer && !bearer) return jsonError(401, "missing or invalid bearer token");
      if (bearer) {
        if (!text) return jsonError(400, "text is required");
        if (bearer.agentId === agentId) return jsonError(400, "cannot send to self");
        const senderInfo = AgentManager.getAgentDisplay(bearer.agentId);
        if (!senderInfo) return jsonError(400, "sender agent is not known");
        const result = AgentManager.enqueueMessage(agentId, {
          sender: { kind: "agent", agentId: bearer.agentId, agentName: senderInfo.name, roomName: senderInfo.roomName },
          text,
        });
        if (!result.ok) return jsonError(result.status, result.error);
        return new Response(JSON.stringify({ messageId: result.messageId }), { headers: JSON_HEADERS });
      }
      const denied = requireUserAgentAccess(auth, agentId);
      if (denied) return denied;
      const username = sessionUser(auth)?.name;
      const attachments = Array.isArray(body?.attachments) ? (body.attachments as Attachment[]) : undefined;
      void AgentManager.sendMessage(agentId, text, username, attachments);
      return new Response(JSON.stringify({ messageId: "" }), { headers: JSON_HEADERS });
    }

    if (req.method === "POST" && parts.length === 3 && parts[2] === "resume") {
      const denied = requireUserAgentAccess(auth, agentId);
      if (denied) return denied;
      const body = await readJsonBody(req);
      const sessionId = typeof body?.sessionId === "string" ? body.sessionId : "";
      if (!sessionId) return jsonError(422, "sessionId is required");
      void AgentManager.resume(agentId, sessionId);
      return new Response(null, { status: 204, headers: JSON_HEADERS });
    }

    if (req.method === "POST" && parts.length === 3 && parts[2] === "new-conversation") {
      const denied = requireUserAgentAccess(auth, agentId);
      if (denied) return denied;
      void AgentManager.newConversation(agentId);
      return new Response(null, { status: 204, headers: JSON_HEADERS });
    }

    if (req.method === "POST" && parts.length === 3 && parts[2] === "send-now") {
      const denied = requireUserAgentAccess(auth, agentId);
      if (denied) return denied;
      void AgentManager.sendNow(agentId);
      return new Response(null, { status: 204, headers: JSON_HEADERS });
    }
  }

  const bearerResponse = await handleAgentBearerPost(req, parts);
  if (bearerResponse) return bearerResponse;

  return null;
}
