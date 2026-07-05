import * as AgentManager from "../agent-manager.ts";
import { readBearerToken, resolveAgentToken } from "../agents/tokens.ts";

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
 *
 * Legacy /agents/:id/... aliases stay accepted for older agent prompts.
 *
 * Returns null for any other URL so the caller can fall through.
 */
export async function handleAgentsRequest(req: Request, url: URL): Promise<Response | null> {
  const parts = agentRouteParts(url.pathname);
  if (!parts) return null;

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

function agentRouteParts(pathname: string): string[] | null {
  const parts = pathname.split("/").filter(Boolean);
  if (parts[0] === "agents") return parts;
  if (parts[0] === "api" && parts[1] === "agents") return parts.slice(1);
  return null;
}
