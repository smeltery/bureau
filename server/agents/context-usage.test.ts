import { afterEach, describe, expect, test } from "bun:test";
import { DEFAULT_AGENT_CAPABILITIES, type AgentInfo } from "../../shared/types.ts";
import { createManagedAgent } from "./managed-factory.ts";
import { maybeNudgeForContextUsage } from "./context-usage.ts";
import { agents, logCache } from "./state.ts";

afterEach(() => {
  agents.clear();
  logCache.clear();
});

function managedWithContext(percentage: number) {
  const info: AgentInfo = {
    id: "agent-1",
    name: "Context Test",
    desk: 0,
    room: 0,
    cwd: process.cwd(),
    outfit: { hat: "none", color: "#000", hair: "#000", hairStyle: "short", skin: "#000", beard: "none", accessory: null },
    permissionMode: "default",
    modelFamily: "sonnet",
    agentType: "claude",
    capabilities: DEFAULT_AGENT_CAPABILITIES,
    state: "idle",
    topic: null,
    topicStale: false,
    customInstructions: null,
    contextUsage: {
      model: "claude-sonnet",
      totalTokens: percentage,
      maxTokens: 100,
      percentage,
      sampledAtMs: Date.now(),
    },
  };
  const managed = createManagedAgent({ info, skillCwd: process.cwd(), slashCommands: [], skills: [] });
  agents.set(info.id, managed);
  return managed;
}

describe("maybeNudgeForContextUsage", () => {
  test("emits the 50 percent nudge only once", () => {
    const managed = managedWithContext(51);

    maybeNudgeForContextUsage("agent-1", managed);
    maybeNudgeForContextUsage("agent-1", managed);

    const logs = logCache.get("agent-1") ?? [];
    expect(logs).toHaveLength(1);
    expect(logs[0].content).toContain("over 50% full");
    expect(logs[0].metadata?.contextThreshold).toBe(50);
    expect(managed.pendingContextNotices).toHaveLength(1);
    expect(managed.pendingContextNotices[0]).toContain("over 50% full");
  });

  test("emits the 75 percent nudge after the 50 percent nudge", () => {
    const managed = managedWithContext(51);
    maybeNudgeForContextUsage("agent-1", managed);
    managed.info.contextUsage = { ...managed.info.contextUsage!, percentage: 76 };

    maybeNudgeForContextUsage("agent-1", managed);

    const logs = logCache.get("agent-1") ?? [];
    expect(logs).toHaveLength(2);
    expect(logs[1].content).toContain("over 75% full");
    expect(logs[1].metadata?.contextThreshold).toBe(75);
    expect(managed.pendingContextNotices).toHaveLength(2);
  });
});
