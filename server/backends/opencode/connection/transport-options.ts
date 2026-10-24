import type { AgentMcpServer } from "../../../integrations/mcp.ts";
import type { OpenCodeSupervisor } from "../supervisor.ts";
import type { OpenCodeAuthorityBroker } from "../authority-broker.ts";

export interface OpenCodeTransportOptions {
  disableTools?: boolean;
  mcpServers?: AgentMcpServer[];
  cwd: string;
  model: string;
  resolveEnv?: () => Record<string, string | undefined> | undefined;
  effort?: string;
  systemPrompt?: string;
  agent?: string;
  supervisor: OpenCodeSupervisor;
  sessionId?: string;
  autoApprove?: boolean;
  agentId?: string;
  agentToken?: string;
  authorityBroker?: OpenCodeAuthorityBroker;
  requestTimeoutMs?: number;
  eventIdleTimeoutMs?: number;
}
