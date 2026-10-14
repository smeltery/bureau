import type { Query } from "@anthropic-ai/claude-agent-sdk";
import type { AgentMcpServer } from "../../integrations/mcp.ts";

/** Register over the control channel: SDK launch options would put headers on argv. */
export async function registerClaudeMcp(query: Pick<Query, "setMcpServers">, servers?: AgentMcpServer[], timeoutMs = 15000): Promise<void> {
  if (!servers?.length) return;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const registering = query.setMcpServers(Object.fromEntries(servers.map((server) => [server.name, { type: "http" as const, url: server.url, headers: server.headers }])));
    const result = await Promise.race([
      registering,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error("MCP registration timed out.")), timeoutMs);
      }),
    ]);
    if (Object.keys(result.errors ?? {}).length) console.warn("[integrations] some Claude MCP connections could not be established");
  } catch {
    console.warn("[integrations] Claude MCP registration did not complete; retry the connection from Settings");
  } finally {
    clearTimeout(timer);
  }
}
