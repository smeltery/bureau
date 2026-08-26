import type { AgentInfo } from "../../shared/types.ts";
import { DEFAULT_AGENT_CAPABILITIES } from "../../shared/types.ts";
import { versionOf } from "../memory-store.ts";

export const TEST_AGENT_OUTFIT: AgentInfo["outfit"] = {
  hat: "none",
  color: "#000000",
  hair: "#000000",
  hairStyle: "short",
  skin: "#000000",
  beard: "none",
  accessory: null,
};

export function testAgentInfo(overrides: Partial<AgentInfo> = {}): AgentInfo {
  const customInstructions = overrides.customInstructions ?? null;
  return {
    id: "agent-test",
    name: "Test Agent",
    desk: 0,
    room: 0,
    cwd: process.cwd(),
    outfit: TEST_AGENT_OUTFIT,
    permissionMode: "default",
    modelFamily: "sonnet",
    agentType: "claude",
    capabilities: DEFAULT_AGENT_CAPABILITIES,
    state: "idle",
    topic: null,
    topicStale: false,
    customInstructions,
    customInstructionsVersion: overrides.customInstructionsVersion ?? versionOf(customInstructions ?? ""),
    ...overrides,
  };
}
