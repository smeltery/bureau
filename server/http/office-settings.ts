import type { AuthResult } from "../auth/auth-middleware.ts";
import * as AgentManager from "../agent-manager.ts";

const jsonHeaders = { "Access-Control-Allow-Origin": "*", "Content-Type": "application/json" };
const noContentHeaders = { "Access-Control-Allow-Origin": "*" };

export async function handleOfficeSettingsRequest(req: Request, url: URL, auth: AuthResult): Promise<Response | null> {
  if (req.method === "OPTIONS" && url.pathname === "/api/office/settings") {
    return new Response(null, {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, PUT, OPTIONS",
        "Access-Control-Allow-Headers": "Authorization, Content-Type",
      },
    });
  }

  if (url.pathname !== "/api/office/settings") return null;
  // DELIBERATELY owner-session-only: no `privilegedAgentIdentity` path here. The
  // office prompt is the top of the prompt chain injected into every agent in
  // the office, including the privileged one asking — letting an agent rewrite
  // it would let it rewrite its own standing instructions and every peer's.
  // Upstream excludes `office:admin` from the privileged set for the same
  // reason. Rooms are the boundary a privileged agent manages; the office is not.
  if (auth.kind !== "ok") return error(401, "authenticated browser session required");
  if (auth.session.role !== "owner") return error(403, "owner access required");

  if (req.method === "GET") {
    return new Response(JSON.stringify(AgentManager.getOfficeSettings()), { headers: jsonHeaders });
  }

  if (req.method === "PUT") {
    const body = await readJson(req);
    if (body instanceof Response) return body;
    const prompt = typeof body.prompt === "string" ? body.prompt : null;
    const envFile = typeof body.envFile === "string" && body.envFile.trim() ? body.envFile.trim() : null;
    if (envFile) {
      try {
        AgentManager.validateEnvPath(envFile);
      } catch (err) {
        return error(422, err instanceof Error ? err.message : "invalid env file");
      }
    }
    AgentManager.setOfficeSettings(prompt, envFile);
    return new Response(null, { status: 204, headers: noContentHeaders });
  }

  return error(404, "not found");
}

async function readJson(req: Request): Promise<Record<string, unknown> | Response> {
  try {
    return (await req.json()) as Record<string, unknown>;
  } catch {
    return error(400, "invalid JSON");
  }
}

function error(status: number, message: string): Response {
  return new Response(JSON.stringify({ error: message }), { status, headers: jsonHeaders });
}
