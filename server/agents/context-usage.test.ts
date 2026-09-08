import { afterEach, describe, expect, test } from "bun:test";
import { DEFAULT_AGENT_CAPABILITIES, type AgentInfo } from "../../shared/types.ts";
import { createManagedAgent } from "./managed-factory.ts";
import { maybeEmitUiContextNotice, maybeNudgeForContextUsage, pickContextThreshold } from "./context-usage.ts";
import { agents, logCache } from "./state.ts";

afterEach(() => {
  agents.clear();
  logCache.clear();
});

function managedWithContext(percentage: number, opts: { agentType?: AgentInfo["agentType"]; maxTokens?: number } = {}) {
  const agentType = opts.agentType ?? "claude";
  const maxTokens = opts.maxTokens ?? 1_000_000;
  const info: AgentInfo = {
    id: "agent-1",
    name: "Context Test",
    desk: 0,
    room: 0,
    cwd: process.cwd(),
    outfit: { hat: "none", color: "#000", hair: "#000", hairStyle: "short", skin: "#000", beard: "none", accessory: null },
    permissionMode: "default",
    modelFamily: "sonnet",
    agentType,
    capabilities: DEFAULT_AGENT_CAPABILITIES,
    state: "idle",
    topic: null,
    topicStale: false,
    customInstructions: null,
    contextUsage: {
      model: "claude-sonnet",
      totalTokens: Math.round((percentage / 100) * maxTokens),
      maxTokens,
      percentage,
      sampledAtMs: Date.now(),
    },
  };
  const managed = createManagedAgent({ info, skillCwd: process.cwd(), slashCommands: [], skills: [] });
  agents.set(info.id, managed);
  return managed;
}

describe("pickContextThreshold", () => {
  test("skips the size-gated 50 band on a small window", () => {
    expect(pickContextThreshold(55, 200_000, new Set())).toBeNull();
    expect(pickContextThreshold(76, 200_000, new Set())).toBe(75);
  });

  test("allows the 50 band on a large window", () => {
    expect(pickContextThreshold(55, 1_000_000, new Set())).toBe(50);
  });
});

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

  test("skips the noisy 50 band on a small window but still nudges at 75", () => {
    const managed = managedWithContext(55, { maxTokens: 200_000 });
    maybeNudgeForContextUsage("agent-1", managed);
    expect(logCache.get("agent-1") ?? []).toHaveLength(0);

    managed.info.contextUsage = { ...managed.info.contextUsage!, percentage: 76 };
    maybeNudgeForContextUsage("agent-1", managed);
    const logs = logCache.get("agent-1") ?? [];
    expect(logs).toHaveLength(1);
    expect(logs[0].metadata?.contextThreshold).toBe(75);
  });

  test("suppresses context-budget handoff advice for Codex agents", () => {
    const managed = managedWithContext(76, { agentType: "codex" });

    maybeNudgeForContextUsage("agent-1", managed);

    expect(logCache.get("agent-1") ?? []).toHaveLength(0);
    expect(managed.pendingContextNotices).toHaveLength(0);
  });
});

describe("maybeEmitUiContextNotice", () => {
  test("emits an ephemeral wrap-up line once per band", () => {
    const managed = managedWithContext(51);
    maybeEmitUiContextNotice("agent-1", managed);
    maybeEmitUiContextNotice("agent-1", managed);

    const logs = logCache.get("agent-1") ?? [];
    expect(logs).toHaveLength(1);
    expect(logs[0].ephemeral).toBe(true);
    expect(logs[0].content).toContain("Context is 51% full");
    expect(logs[0].content).toContain("/clear");
    expect(logs[0].content).toContain("/handoff");
    expect(logs[0].metadata?.contextAudience).toBe("ui");
    expect(managed.firedUiThresholds.has(50)).toBe(true);
  });

  test("when the first sample clears both bands, only the highest emits", () => {
    const managed = managedWithContext(87);
    maybeEmitUiContextNotice("agent-1", managed);

    const logs = logCache.get("agent-1") ?? [];
    expect(logs).toHaveLength(1);
    expect(logs[0].content).toContain("Context is 87% full");
    expect(managed.firedUiThresholds.has(50)).toBe(true);
    expect(managed.firedUiThresholds.has(75)).toBe(true);
  });

  test("does not suppress agent nudges when the UI notice has fired", () => {
    const managed = managedWithContext(51);
    maybeEmitUiContextNotice("agent-1", managed);
    maybeNudgeForContextUsage("agent-1", managed);

    const logs = logCache.get("agent-1") ?? [];
    expect(logs).toHaveLength(2);
    expect(logs[1].metadata?.contextAudience).toBe("agent");
  });

  test("skips Codex", () => {
    const managed = managedWithContext(80, { agentType: "codex" });
    maybeEmitUiContextNotice("agent-1", managed);
    expect(logCache.get("agent-1") ?? []).toHaveLength(0);
  });
});
