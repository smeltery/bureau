import type { AgentInfo } from "../../shared/types.ts";
import { DEFAULT_AGENT_CAPABILITIES } from "../../shared/types.ts";
import { getBackend } from "../backends/index.ts";
import type { loadAgents } from "../persistence.ts";

type PersistedAgent = ReturnType<typeof loadAgents>[number]["agents"][number];

export function buildRestoredAgentInfo(persisted: PersistedAgent, room: number): AgentInfo {
  const agentType = persisted.agentType ?? "claude";
  return {
    id: persisted.id,
    name: persisted.name,
    userId: persisted.userId ?? null,
    desk: persisted.desk,
    room,
    cwd: persisted.cwd,
    outfit: persisted.outfit,
    permissionMode: persisted.permissionMode,
    modelFamily: persisted.modelFamily ?? "opus",
    agentType,
    capabilities: getBackend(agentType).capabilities ?? DEFAULT_AGENT_CAPABILITIES,
    privileged: persisted.privileged ?? false,
    ...(persisted.codexSandbox ? { codexSandbox: persisted.codexSandbox } : {}),
    ...(persisted.effort ? { effort: persisted.effort } : {}),
    state: persisted.lastSessionId ? "waiting_for_response" : "idle",
    topic: persisted.topic ?? null,
    // Stale-on-load is determined by the textCount scan after logs are loaded
    // into the cache. Default false avoids flashing the refresh button on
    // agents whose persisted topic is still current.
    topicStale: false,
    customInstructions: persisted.customInstructions ?? null,
    queue: [],
  };
}
