import * as AgentManager from "../agent-manager.ts";
import { readBearerToken } from "../agents/tokens.ts";
import type { AuthResult } from "../auth/auth-middleware.ts";
import { JSON_HEADERS, jsonError, readJsonBody, requireUserAgentAccess } from "./agent-route-helpers.ts";

/** Cookie-session GET/POST for `/api/agents/:id/browser` (agents use bearer). */
export async function handleAgentBrowserSessionRoute(req: Request, parts: string[], agentId: string, auth: AuthResult | undefined): Promise<Response | null> {
  if (parts.length !== 3 || parts[2] !== "browser" || readBearerToken(req)) return null;
  const denied = requireUserAgentAccess(auth, agentId);
  if (denied) return denied;
  if (req.method === "GET") {
    const { browserPool } = await import("../browser/session.ts");
    const peek = browserPool.peek(agentId);
    return new Response(
      JSON.stringify({
        enabled: AgentManager.getOfficeSettings().experimental.browserPanel,
        ...peek,
      }),
      { headers: JSON_HEADERS },
    );
  }
  if (req.method === "POST") {
    const body = await readJsonBody(req);
    if (!body) return jsonError(400, "invalid JSON body");
    const result = await AgentManager.emitAgentBrowser(agentId, body);
    if (!result.ok) {
      const payload: Record<string, unknown> = { error: result.error };
      if (result.code) payload.code = result.code;
      if (result.dialogs) payload.dialogs = result.dialogs;
      return new Response(JSON.stringify(payload), { status: result.status, headers: JSON_HEADERS });
    }
    return new Response(JSON.stringify(result.result), { headers: JSON_HEADERS });
  }
  return null;
}
