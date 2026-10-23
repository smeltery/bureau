import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { readBearerToken } from "../agents/tokens.ts";
import { resolveApiToken } from "../auth/api-tokens.ts";
import { originAllowed } from "../public-origin.ts";
import { callOfficeTool } from "./actions.ts";
import { officeTools, OfficeToolError } from "./tools.ts";

export async function handleOfficeMcp(req: Request, connection?: { timeout(req: Request, seconds: number): void }): Promise<Response> {
  if (!originAllowed(req, new URL(req.url))) return Response.json({ error: "bad_origin" }, { status: 403 });
  const raw = readBearerToken(req);
  if (!raw || !resolveApiToken(raw)) {
    return Response.json({ error: "personal_api_token_required" }, { status: 401, headers: { "WWW-Authenticate": 'Bearer realm="Bureau"' } });
  }
  if (req.method !== "POST") return new Response(null, { status: 405, headers: { Allow: "POST" } });
  // Unix-socket listeners can retain Bun’s short default idle timeout.
  connection?.timeout(req, 30);
  // Each request has its own server and transport: no session can retain a
  // revoked credential or accidentally borrow another token's identity.
  const server = new Server({ name: "bureau", version: "1.0.0" }, { capabilities: { tools: {} } });
  const transport = new WebStandardStreamableHTTPServerTransport({ enableJsonResponse: true });
  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: officeTools }));
  server.setRequestHandler(CallToolRequestSchema, async ({ params }) => {
    try {
      const result = await callOfficeTool(params.name, params.arguments ?? {}, raw, req.signal);
      return { content: [{ type: "text", text: JSON.stringify(result) }] };
    } catch (error) {
      if (!(error instanceof OfficeToolError) && !req.signal.aborted) console.error("[mcp] tool failed:", error);
      return { isError: true, content: [{ type: "text", text: error instanceof OfficeToolError ? error.message : req.signal.aborted ? "request_cancelled" : "tool_failed" }] };
    }
  });
  try {
    await server.connect(transport);
    const response = await transport.handleRequest(req);
    response.headers.set("Cache-Control", "no-store");
    return response;
  } finally {
    await server.close();
  }
}
