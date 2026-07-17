import { afterEach, describe, expect, test } from "bun:test";

import { DEFAULT_AGENT_CAPABILITIES, type AgentInfo } from "../../../shared/types.ts";
import type { BackendSession } from "../../backends/types.ts";
import { createManagedAgent } from "../managed-factory.ts";
import { agents, logCache, type ManagedAgent } from "../state.ts";
import { flushQueue } from "./message-queue.ts";

afterEach(() => {
  agents.clear();
  logCache.clear();
});

function makeAgent(id: string, session: BackendSession): ManagedAgent {
  const info: AgentInfo = {
    id,
    name: "Queue Test",
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
  const managed = createManagedAgent({ info, skillCwd: process.cwd(), slashCommands: [], skills: [] });
  managed.session = session;
  agents.set(id, managed);
  return managed;
}

function fakeSession(sendImpl: (text: string) => Promise<void> | void): BackendSession {
  return {
    async *stream() {},
    async getContextUsage() {
      return null;
    },
    async send(text: string) {
      await sendImpl(text);
    },
    async approve() {},
    async abort() {},
    canAbortInPlace() {
      return false;
    },
    close() {},
  };
}

function settleTurn(managed: ManagedAgent) {
  const pending = managed.pendingTurn;
  managed.pendingTurn = null;
  pending?.resolve();
}

describe("flushQueue", () => {
  test("retains queued messages when send fails before acceptance", async () => {
    const managed = makeAgent(
      "agent-1",
      fakeSession(async () => {
        throw new Error("transport down");
      }),
    );
    managed.messageQueue.push({ id: "msg-1", sender: { kind: "user", username: "Nil" }, text: "please retry", queuedAt: Date.now() });

    await flushQueue("agent-1");

    expect(managed.messageQueue.map((m) => m.id)).toEqual(["msg-1"]);
    expect(managed.info.state).toBe("error");
    expect(logCache.get("agent-1")?.some((entry) => entry.kind === "error" && entry.content.includes("transport down"))).toBe(true);
  });

  test("drains only the accepted batch and leaves later arrivals queued", async () => {
    let managed!: ManagedAgent;
    let addedLater = false;
    managed = makeAgent(
      "agent-1",
      fakeSession(async () => {
        if (!addedLater) {
          addedLater = true;
          managed.messageQueue.push({ id: "msg-2", sender: { kind: "user", username: "Nil" }, text: "arrived later", queuedAt: Date.now() });
        }
        settleTurn(managed);
      }),
    );
    managed.messageQueue.push({ id: "msg-1", sender: { kind: "user", username: "Nil" }, text: "send first", queuedAt: Date.now() });

    await flushQueue("agent-1");

    expect(managed.messageQueue.map((m) => m.id)).toEqual(["msg-2"]);
    expect(
      logCache
        .get("agent-1")
        ?.filter((entry) => entry.kind === "user_message")
        .map((entry) => entry.content),
    ).toEqual(["send first"]);
  });
});
