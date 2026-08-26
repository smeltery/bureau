import { afterEach, describe, expect, test } from "bun:test";

import { DEFAULT_AGENT_CAPABILITIES, type AgentInfo } from "../../../shared/types.ts";
import type { BackendSession, NormalizedEvent } from "../../backends/types.ts";
import { createManagedAgent } from "../managed-factory.ts";
import { agents, logCache } from "../state.ts";
import { runConsumer } from "./event-consumer.ts";

afterEach(() => {
  agents.clear();
  logCache.clear();
});

function agentInfo(id: string): AgentInfo {
  return {
    id,
    name: "Event Consumer Test",
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
    agentType: "claude",
    capabilities: DEFAULT_AGENT_CAPABILITIES,
    state: "waiting_for_response",
    topic: null,
    topicStale: false,
    customInstructions: null,
  };
}

function eventSession(events: NormalizedEvent[]): BackendSession {
  return {
    async *stream() {
      yield* events;
    },
    async getContextUsage() {
      return null;
    },
    async send() {},
    async approve() {},
    async abort() {},
    canAbortInPlace() {
      return false;
    },
    close() {},
  };
}

describe("runConsumer", () => {
  test("does not let late activity restore a busy state after a turn ends", async () => {
    const session = eventSession([
      { kind: "turn_completed", status: "completed" },
      { kind: "tool_call", toolUseId: "late-1", name: "Bash", input: { command: "date" } },
      { kind: "assistant_text", text: "late text" },
    ]);
    const managed = createManagedAgent({ info: agentInfo("agent-1"), skillCwd: process.cwd(), slashCommands: [], skills: [] });
    managed.session = session;
    managed.turnStartedAt = 123;
    managed.info = { ...managed.info, state: "thinking" };
    agents.set("agent-1", managed);

    await runConsumer("agent-1", managed, session);

    expect(managed.turnStartedAt).toBe(0);
    expect(managed.info.state).toBe("waiting_for_response");
    expect(logCache.get("agent-1")?.map((entry) => entry.kind)).toEqual(["tool_call", "text"]);
  });
});
