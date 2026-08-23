import { afterEach, describe, expect, spyOn, test } from "bun:test";

import { DEFAULT_AGENT_CAPABILITIES, type AgentInfo } from "../../shared/types.ts";
import { createManagedAgent } from "./managed-factory.ts";
import { _testLastForcedRecoveryAt, _testSetBusyTurnWatchdogStuckMs, oldestActiveTool, sweepBusyTurnWatchdog } from "./queue-watchdog.ts";
import { agents, logCache, persistAll, type ManagedAgent } from "./state.ts";

afterEach(() => {
  agents.clear();
  logCache.clear();
  persistAll();
  _testSetBusyTurnWatchdogStuckMs(10 * 60_000);
});

function makeAgent(id: string, agentType: AgentInfo["agentType"] = "claude"): ManagedAgent {
  const info: AgentInfo = {
    id,
    name: "Watchdog Test",
    desk: 0,
    room: 0,
    cwd: process.cwd(),
    outfit: {
      hat: "none",
      color: "#000000",
      hair: "#000000",
      hairStyle: "short",
      skin: "#000000",
      beard: "none",
      accessory: null,
    },
    permissionMode: "default",
    modelFamily: "sonnet",
    agentType,
    capabilities: DEFAULT_AGENT_CAPABILITIES,
    state: "tool_executing",
    topic: null,
    topicStale: false,
    customInstructions: null,
  };
  const managed = createManagedAgent({ info, skillCwd: process.cwd(), slashCommands: [], skills: [] });
  managed.pendingTurn = {
    promise: Promise.resolve(),
    resolve() {},
    reject() {},
    anchorEntryId: null,
  };
  managed.turnStartedAt = 100;
  managed.lastNormalizedEventAt = 200;
  managed.messageQueue.push({
    id: "msg-1",
    sender: { kind: "user", username: "Boss" },
    text: "queued",
    queuedAt: 250,
  });
  agents.set(id, managed);
  return managed;
}

describe("busy turn queue watchdog", () => {
  test("does not recover while a tool is still active", async () => {
    const managed = makeAgent("agent-1");
    managed.toolCallTimestamps.set("tool-1", { name: "Bash", startedAt: 150 });
    _testSetBusyTurnWatchdogStuckMs(0);

    expect(oldestActiveTool(managed)).toEqual({ name: "Bash", startedAt: 150 });
    expect(await sweepBusyTurnWatchdog(1_000)).toBe(0);
    expect(_testLastForcedRecoveryAt("agent-1")).toBe(0);
  });

  test("observes thinking and non-Claude stuck signatures without recovering", async () => {
    const thinking = makeAgent("thinking-agent");
    thinking.info.state = "thinking";
    const codex = makeAgent("codex-agent", "codex");
    _testSetBusyTurnWatchdogStuckMs(0);
    const warn = spyOn(console, "warn").mockImplementation(() => {});

    try {
      expect(await sweepBusyTurnWatchdog(1_000)).toBe(0);
      expect(await sweepBusyTurnWatchdog(1_100)).toBe(0);
      expect(warn.mock.calls.length).toBe(2);
    } finally {
      warn.mockRestore();
    }

    expect(thinking.busyTurnWatchdogObserved).toBe(true);
    expect(codex.busyTurnWatchdogObserved).toBe(true);
    expect(_testLastForcedRecoveryAt("thinking-agent")).toBe(0);
    expect(_testLastForcedRecoveryAt("codex-agent")).toBe(0);
  });
});
