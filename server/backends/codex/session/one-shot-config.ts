import type { JsonRpcLiteClient } from "../client.ts";
import { CODEX_THREAD_CONFIG_OVERRIDES } from "../config.ts";

const DISABLED_FEATURES = [
  "shell_tool",
  "unified_exec",
  "apps",
  "connectors",
  "plugins",
  "hooks",
  "plugin_hooks",
  "browser_use",
  "computer_use",
  "code_mode",
  "js_repl",
  "multi_agent",
  "multi_agent_v2",
  "image_generation",
  "tool_suggest",
  "skill_mcp_dependency_install",
];

export const ONE_SHOT_ARGS = ["app-server", "--listen", "stdio://", ...DISABLED_FEATURES.flatMap((feature) => ["-c", `features.${feature}=false`]), "-c", 'web_search="disabled"'];

/** Override every effective server individually: an empty table would merge with user config. */
export async function oneShotConfig(client: Pick<JsonRpcLiteClient, "request">, cwd: string) {
  const response = await client.request<{ config: { mcp_servers?: unknown } }>("config/read", { includeLayers: false, cwd });
  const servers = response.config.mcp_servers;
  if (servers !== undefined && servers !== null && (typeof servers !== "object" || Array.isArray(servers))) throw new Error("Invalid background MCP configuration");
  const mcpServers = Object.fromEntries(Object.keys(servers ?? {}).map((name) => [name, { enabled: false }]));
  return {
    ...CODEX_THREAD_CONFIG_OVERRIDES,
    ...Object.fromEntries(DISABLED_FEATURES.map((feature) => [`features.${feature}`, false])),
    web_search: "disabled",
    mcp_servers: mcpServers,
  };
}
