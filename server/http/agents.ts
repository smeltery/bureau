import * as AgentManager from "../agent-manager.ts";

const JSON_HEADERS = { "Access-Control-Allow-Origin": "*", "Content-Type": "application/json" };

/**
 * Handle agent-scoped HTTP routes:
 *   POST /agents/:id/diff             — emit a styled diff card (optional body: { dir }).
 *   POST /agents/:id/edit-file        — emit an [Open in editor] card (body: { path }).
 *   POST /agents/:id/terminal-command — emit a [Copy to terminal] card (body: { command }).
 *
 * Returns null for any other URL so the caller can fall through.
 */
export async function handleAgentsRequest(req: Request, url: URL): Promise<Response | null> {
  if (!url.pathname.startsWith("/agents/")) return null;

  if (req.method === "POST") {
    const parts = url.pathname.split("/").filter(Boolean);
    if (parts.length === 3 && parts[2] === "diff") {
      const agentId = parts[1]!;
      let dir: string | undefined;
      try {
        const body = (await req.json()) as Record<string, unknown> | null;
        if (body && typeof body.dir === "string") dir = body.dir;
      } catch {}
      const result = AgentManager.emitAgentDiff(agentId, dir);
      if (!result.ok) return new Response(JSON.stringify({ error: result.error }), { status: result.status, headers: JSON_HEADERS });
      return new Response(JSON.stringify({ ok: true }), { headers: JSON_HEADERS });
    }
    if (parts.length === 3 && parts[2] === "edit-file") {
      const agentId = parts[1]!;
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
    if (parts.length === 3 && parts[2] === "terminal-command") {
      const agentId = parts[1]!;
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
  }

  return null;
}
