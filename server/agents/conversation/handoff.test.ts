import { afterEach, describe, expect, test } from "bun:test";

import { DEFAULT_AGENT_CAPABILITIES, type AgentInfo } from "../../../shared/types.ts";
import type { BackendSession } from "../../backends/types.ts";
import { createManagedAgent } from "../managed-factory.ts";
import { agents, logCache, persistAll, type ManagedAgent } from "../state.ts";
import { handoff } from "./control.ts";
import { enqueueMessage } from "./message-queue.ts";

afterEach(() => {
  agents.clear();
  logCache.clear();
  persistAll();
});

function makeAgent(id: string, session: BackendSession) {
  const info: AgentInfo = {
    id,
    name: "Handoff Test",
    desk: 0,
    room: 0,
    cwd: process.cwd(),
    outfit: { hat: "none", color: "#000000", hair: "#000000", hairStyle: "short", skin: "#000000", beard: "none", accessory: null },
    permissionMode: "default",
    modelFamily: "sonnet",
    agentType: "claude",
    capabilities: DEFAULT_AGENT_CAPABILITIES,
    state: "waiting_for_response",
    topic: null,
    topicStale: false,
    customInstructions: null,
  };
  const managed = createManagedAgent({ info, skillCwd: process.cwd(), slashCommands: [], skills: [] });
  managed.session = session;
  agents.set(id, managed);
  return managed;
}

function settleTurn(managed: ManagedAgent) {
  const pending = managed.pendingTurn;
  managed.pendingTurn = null;
  pending?.resolve();
}

function fakeSession(managed: ManagedAgent, sendImpl: (text: string) => Promise<void> | void): BackendSession {
  return {
    async *stream() {},
    async getContextUsage() {
      return null;
    },
    async send(text: string) {
      await sendImpl(text);
      settleTurn(managed);
    },
    async approve() {},
    async abort() {},
    canAbortInPlace() {
      return false;
    },
    close() {},
  };
}

describe("handoff", () => {
  test("resets the session and delivers a self-handoff brief", async () => {
    const managed = createManagedAgent({
      info: {
        id: "agent-1",
        name: "Handoff Test",
        desk: 0,
        room: 0,
        cwd: process.cwd(),
        outfit: { hat: "none", color: "#000000", hair: "#000000", hairStyle: "short", skin: "#000000", beard: "none", accessory: null },
        permissionMode: "default",
        modelFamily: "sonnet",
        agentType: "claude",
        capabilities: DEFAULT_AGENT_CAPABILITIES,
        state: "waiting_for_response",
        topic: null,
        topicStale: false,
        customInstructions: null,
      },
      skillCwd: process.cwd(),
      slashCommands: [],
      skills: [],
    });
    managed.session = fakeSession(managed, () => {});
    agents.set("agent-1", managed);

    const result = await handoff("agent-1", "Finish wiring the widget.");
    expect(result).toEqual({ ok: true, queued: false, messageId: expect.any(String) });
    expect(logCache.get("agent-1")?.some((entry) => entry.kind === "system" && entry.content === "New conversation started.")).toBe(true);
  });

  test("rejects a concurrent handoff with handoff_in_progress", async () => {
    const managed = makeAgent("agent-1", {
      async *stream() {},
      async getContextUsage() {
        return null;
      },
      async send() {
        await new Promise((resolve) => setTimeout(resolve, 50));
      },
      async approve() {},
      async abort() {},
      canAbortInPlace() {
        return false;
      },
      close() {},
    });
    void managed;

    const first = handoff("agent-1", "first brief");
    const second = await handoff("agent-1", "second brief");
    expect(second).toEqual({ ok: false, error: "handoff_in_progress", status: 409 });
    await first;
  });

  test("enqueueMessage stores handoff metadata for flush", async () => {
    const managed = createManagedAgent({
      info: {
        id: "agent-1",
        name: "Handoff Test",
        desk: 0,
        room: 0,
        cwd: process.cwd(),
        outfit: { hat: "none", color: "#000000", hair: "#000000", hairStyle: "short", skin: "#000000", beard: "none", accessory: null },
        permissionMode: "default",
        modelFamily: "sonnet",
        agentType: "claude",
        capabilities: DEFAULT_AGENT_CAPABILITIES,
        state: "waiting_for_response",
        topic: null,
        topicStale: false,
        customInstructions: null,
      },
      skillCwd: process.cwd(),
      slashCommands: [],
      skills: [],
    });
    managed.session = fakeSession(managed, () => {});
    agents.set("agent-1", managed);
    const result = enqueueMessage("agent-1", {
      sender: { kind: "agent", agentId: "agent-1", agentName: "Handoff Test", roomName: "Room" },
      text: "carry on",
      handoff: true,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(agents.get("agent-1")?.messageQueue[0]?.handoff).toBe(true);
  });
});
