import * as AgentManager from "../agent-manager.ts";
import { readBearerToken, resolveAgentToken } from "../agents/tokens.ts";
import type { AuthResult } from "../auth/auth-middleware.ts";
import { canSeeRoom, getUserById } from "../users.ts";
import type { Attachment, UserRecord } from "../../shared/types.ts";

const JSON_HEADERS = { "Access-Control-Allow-Origin": "*", "Content-Type": "application/json" };

/**
 * Handle agent-scoped HTTP routes:
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

  if (parts[0] === "agents" && parts.length >= 3) {
    const agentId = parts[1]!;
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
      void AgentManager.flushQueue(agentId);
      return new Response(null, { status: 204, headers: JSON_HEADERS });
    }
  }

  if (req.method === "POST") {
    const identity = resolveAgentToken(readBearerToken(req));
    if (!identity) {
      return new Response(JSON.stringify({ error: "missing or invalid bearer token" }), { status: 401, headers: JSON_HEADERS });
    }
    if (parts.length === 3 && parts[2] === "diff") {
      const agentId = parts[1]!;
      if (identity.agentId !== agentId) return new Response(JSON.stringify({ error: "token does not match agent" }), { status: 403, headers: JSON_HEADERS });
      let dir: string | undefined;
      let commit: string | undefined;
      try {
        const body = (await req.json()) as Record<string, unknown> | null;
        if (body && typeof body.dir === "string") dir = body.dir;
        if (body && typeof body.commit === "string") commit = body.commit;
      } catch {}
      const result = AgentManager.emitAgentDiff(agentId, dir, commit);
      if (!result.ok) return new Response(JSON.stringify({ error: result.error }), { status: result.status, headers: JSON_HEADERS });
      return new Response(JSON.stringify({ ok: true }), { headers: JSON_HEADERS });
    }
    if (parts.length === 3 && parts[2] === "edit-file") {
      const agentId = parts[1]!;
      if (identity.agentId !== agentId) return new Response(JSON.stringify({ error: "token does not match agent" }), { status: 403, headers: JSON_HEADERS });
      let path: string | undefined;
      try {
        const body = (await req.json()) as Record<string, unknown> | null;
        if (body && typeof body.path === "string") path = body.path;
      } catch {}
      if (!path) return new Response(JSON.stringify({ error: "missing path" }), { status: 400, headers: JSON_HEADERS });
      const result = AgentManager.emitAgentEditFile(agentId, path);
      if (!result.ok) return new Response(JSON.stringify({ error: result.error }), { status: result.status, headers: JSON_HEADERS });
      return new Response(JSON.stringify({ ok: true }), { headers: JSON_HEADERS });
    }
    if (parts.length === 3 && parts[2] === "read-file") {
      const agentId = parts[1]!;
      if (identity.agentId !== agentId) return new Response(JSON.stringify({ error: "token does not match agent" }), { status: 403, headers: JSON_HEADERS });
      let path: string | undefined;
      try {
        const body = (await req.json()) as Record<string, unknown> | null;
        if (body && typeof body.path === "string") path = body.path;
      } catch {}
      if (!path) return new Response(JSON.stringify({ error: "missing path" }), { status: 400, headers: JSON_HEADERS });
      const result = AgentManager.emitAgentReadFile(agentId, path);
      if (!result.ok) return new Response(JSON.stringify({ error: result.error }), { status: result.status, headers: JSON_HEADERS });
      return new Response(JSON.stringify({ ok: true }), { headers: JSON_HEADERS });
    }
    if (parts.length === 3 && parts[2] === "terminal-command") {
      const agentId = parts[1]!;
      if (identity.agentId !== agentId) return new Response(JSON.stringify({ error: "token does not match agent" }), { status: 403, headers: JSON_HEADERS });
      let command: string | undefined;
      try {
        const body = (await req.json()) as Record<string, unknown> | null;
        if (body && typeof body.command === "string") command = body.command;
      } catch {}
      if (!command) return new Response(JSON.stringify({ error: "missing command" }), { status: 400, headers: JSON_HEADERS });
      const result = AgentManager.emitAgentTerminalCommand(agentId, command);
      if (!result.ok) return new Response(JSON.stringify({ error: result.error }), { status: result.status, headers: JSON_HEADERS });
      return new Response(JSON.stringify({ ok: true }), { headers: JSON_HEADERS });
    }
    if (parts.length === 3 && parts[2] === "message") {
      // The sender's identity (name + room) is looked up server-side from
      // senderAgentId so callers can't spoof identity or inject
      // prefix-delimiter characters into the prompt the receiver sees.
      const receiverId = parts[1]!;
      let body: Record<string, unknown> | null = null;
      try {
        body = (await req.json()) as Record<string, unknown> | null;
      } catch {}
      if (!body) return new Response(JSON.stringify({ error: "invalid JSON body" }), { status: 400, headers: JSON_HEADERS });
      const text = typeof body.text === "string" ? body.text : null;
      const senderAgentId = typeof body.senderAgentId === "string" ? body.senderAgentId : null;
      if (!text || !senderAgentId) {
        return new Response(JSON.stringify({ error: "required: text, senderAgentId" }), { status: 400, headers: JSON_HEADERS });
      }
      if (identity.agentId !== senderAgentId) {
        return new Response(JSON.stringify({ error: "token does not match senderAgentId" }), { status: 403, headers: JSON_HEADERS });
      }
      if (senderAgentId === receiverId) {
        return new Response(JSON.stringify({ error: "cannot send to self" }), { status: 400, headers: JSON_HEADERS });
      }
      const senderInfo = AgentManager.getAgentDisplay(senderAgentId);
      if (!senderInfo) {
        return new Response(JSON.stringify({ error: "senderAgentId is not a known agent" }), { status: 400, headers: JSON_HEADERS });
      }
      const result = AgentManager.enqueueMessage(receiverId, {
        sender: { kind: "agent", agentId: senderAgentId, agentName: senderInfo.name, roomName: senderInfo.roomName },
        text,
      });
      if (!result.ok) {
        return new Response(JSON.stringify({ error: result.error }), { status: result.status, headers: JSON_HEADERS });
      }
      return new Response(JSON.stringify(result), { headers: JSON_HEADERS });
    }
  }

  return null;
}

async function readJsonBody(req: Request): Promise<Record<string, unknown> | null> {
  try {
    const body = await req.json();
    return body && typeof body === "object" && !Array.isArray(body) ? (body as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function jsonError(status: number, error: string): Response {
  return new Response(JSON.stringify({ error }), { status, headers: JSON_HEADERS });
}

function sessionUser(auth: AuthResult | undefined): UserRecord | null {
  if (auth?.kind !== "ok") return null;
  return getUserById(auth.session.userId);
}

function requireUserAgentAccess(auth: AuthResult | undefined, agentId: string): Response | null {
  const agent = AgentManager.getAgent(agentId);
  if (!agent) return jsonError(404, "agent not found");
  if (auth?.kind === "loopback") return null;
  const user = sessionUser(auth);
  if (!user) return jsonError(401, "unauthenticated");
  const roomId = AgentManager.getRooms()[agent.room]?.id;
  if (!roomId || !canSeeRoom(user, roomId)) return jsonError(403, "forbidden");
  return null;
}

function agentRouteParts(pathname: string): string[] | null {
  const parts = pathname.split("/").filter(Boolean);
  if (parts[0] === "agents") return parts;
  if (parts[0] === "api" && parts[1] === "agents") return parts.slice(1);
  return null;
}
