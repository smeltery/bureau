import * as AgentManager from "../agent-manager.ts";

const JSON_HEADERS = { "Access-Control-Allow-Origin": "*", "Content-Type": "application/json" };

/**
 * Handle agent-scoped HTTP routes. Currently:
 *   POST /agents/:id/diff — emit a styled diff card into the agent's chat,
 *     matching the /bureau-diff slash command. Optional body: { dir }.
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
  }

  return null;
}
