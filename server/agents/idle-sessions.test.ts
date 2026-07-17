import { afterEach, describe, expect, test } from "bun:test";

import { DEFAULT_AGENT_CAPABILITIES, type AgentInfo } from "../../shared/types.ts";
import type { BackendSession } from "../backends/types.ts";
import { createManagedAgent } from "./managed-factory.ts";
import { agents, logCache, type ManagedAgent } from "./state.ts";
import { IDLE_SESSION_EVICT_MS, releaseIdleSessions } from "./idle-sessions.ts";

afterEach(() => {
  agents.clear();
  logCache.clear();
});

function makeAgent(id: string, session: BackendSession): ManagedAgent {
  const info: AgentInfo = {
    id,
    name: "Idle Test",
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
  managed.sessionId = "session-1";
  agents.set(id, managed);
  return managed;
}

function fakeSession(onClose?: () => void): BackendSession {
  return {
    async *stream() {},
    async getContextUsage() {
      return null;
    },
    async send() {},
    async approve() {},
    async abort() {},
    canAbortInPlace() {
      return false;
    },
    close() {
      onClose?.();
    },
  };
}

describe("releaseIdleSessions", () => {
  test("closes idle sessions while keeping the agent resumable", async () => {
    let closed = false;
    const managed = makeAgent(
      "agent-1",
      fakeSession(() => (closed = true)),
    );
    managed.consumerPromise = Promise.resolve();
    managed.lastActivityAt = Date.now() - IDLE_SESSION_EVICT_MS - 1;

    const released = await releaseIdleSessions();

    expect(released).toBe(1);
    expect(closed).toBe(true);
    expect(managed.session).toBeNull();
    expect(managed.consumerPromise).toBeNull();
    expect(managed.sessionId).toBe("session-1");
    expect(agents.has("agent-1")).toBe(true);
  });

  test("does not close sessions that still have queued work", async () => {
    let closed = false;
    const managed = makeAgent(
      "agent-1",
      fakeSession(() => (closed = true)),
    );
    managed.lastActivityAt = Date.now() - IDLE_SESSION_EVICT_MS - 1;
    managed.messageQueue.push({ id: "msg-1", sender: { kind: "user", username: "Nil" }, text: "later", queuedAt: Date.now() });

    const released = await releaseIdleSessions();

    expect(released).toBe(0);
    expect(closed).toBe(false);
    expect(managed.session).not.toBeNull();
  });
});
