// Delivery half of the truthful wake-up notice. Bureau log entries are never
// fed back into a prompt, so a log-only wake message would miss every
// occurrence this exists to fix — the agent is the one holding a tool result
// that falsely claims its boss rejected the running command. These tests drive
// the real flushQueue → runAgentTurn path and assert on what the backend
// actually received.
import { afterEach, describe, expect, test } from "bun:test";

import { DEFAULT_AGENT_CAPABILITIES, type AgentInfo } from "../../../shared/types.ts";
import type { BackendSession } from "../../backends/types.ts";
import { createManagedAgent } from "../managed-factory.ts";
import { agents, logCache, persistAll, type ManagedAgent } from "../state.ts";
import { WAKE_NOTICE_BLOCK_OPEN } from "../../plugins/plugin-prefix.ts";
import { flushQueue } from "./message-queue.ts";

const WAKE_NOTE = "Resumed your session after the server restarted. Any command that was in flight may have partially run; verify its effects before retrying.";

afterEach(() => {
  agents.clear();
  logCache.clear();
  // flushQueue persistAll()s test agents into the real BUREAU_DIR; re-persist
  // the cleared map so a later test file that boots the server doesn't restore
  // this file's agents into the shared map mid-suite.
  persistAll();
});

function makeAgent(id: string, session: BackendSession): ManagedAgent {
  const info: AgentInfo = {
    id,
    name: "Wake Test",
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

function enqueue(managed: ManagedAgent, id: string, text: string) {
  managed.messageQueue.push({ id, sender: { kind: "user", username: "Nil" }, text, queuedAt: Date.now() });
}

describe("wake notice delivery", () => {
  test("rides out as a built-in block ahead of the user payload, then clears", async () => {
    const sent: string[] = [];
    let managed!: ManagedAgent;
    managed = makeAgent(
      "agent-1",
      fakeSession((text) => {
        sent.push(text);
        settleTurn(managed);
      }),
    );
    managed.wakeNotice = WAKE_NOTE;
    enqueue(managed, "msg-1", "status?");

    await flushQueue("agent-1");

    expect(sent[0]!.startsWith(WAKE_NOTICE_BLOCK_OPEN)).toBe(true);
    expect(sent[0]).toContain(WAKE_NOTE);
    expect(sent[0]!.indexOf(WAKE_NOTE)).toBeLessThan(sent[0]!.indexOf("status?"));
    expect(managed.wakeNotice).toBeNull();
  });

  test("delivers the note ONCE: the next message carries no wake block", async () => {
    const sent: string[] = [];
    let managed!: ManagedAgent;
    managed = makeAgent(
      "agent-1",
      fakeSession((text) => {
        sent.push(text);
        settleTurn(managed);
      }),
    );
    managed.wakeNotice = WAKE_NOTE;
    enqueue(managed, "msg-1", "first");
    await flushQueue("agent-1");
    // No consumer here to walk the agent back out of "thinking" on
    // turn_completed, so put it back on the idle side of the flush gate by hand.
    managed.info.state = "waiting_for_response";
    enqueue(managed, "msg-2", "second");
    await flushQueue("agent-1");

    expect(sent).toHaveLength(2);
    expect(sent[0]).toContain(WAKE_NOTICE_BLOCK_OPEN);
    // The note was consumed, so the agent isn't re-told about a shutdown it
    // already knows about.
    expect(sent[1]).not.toContain(WAKE_NOTICE_BLOCK_OPEN);
  });

  test("a failed send RETAINS the note (never consumed before acceptance)", async () => {
    const sent: string[] = [];
    let refuse = true;
    let managed!: ManagedAgent;
    managed = makeAgent(
      "agent-1",
      fakeSession((text) => {
        sent.push(text);
        if (refuse) throw new Error("backend refused the send");
        settleTurn(managed);
      }),
    );
    managed.wakeNotice = WAKE_NOTE;
    enqueue(managed, "msg-1", "first");

    await flushQueue("agent-1");
    // The backend never accepted it, so the agent was never told.
    expect(managed.wakeNotice).toBe(WAKE_NOTE);

    refuse = false;
    managed.info.state = "waiting_for_response";
    await flushQueue("agent-1");

    // The next attempt still carries the warning.
    expect(sent).toHaveLength(2);
    expect(sent[1]).toContain(WAKE_NOTICE_BLOCK_OPEN);
    expect(managed.wakeNotice).toBeNull();
  });

  test("a conversation boundary during the send wins the slot", async () => {
    // The post-send clear must not empty a slot that no longer holds the notice
    // it delivered: a /clear (or a fresh wake) landing mid-send leaves behind
    // either null or a NEW conversation's note, and neither is ours to touch.
    let managed!: ManagedAgent;
    managed = makeAgent(
      "agent-1",
      fakeSession(() => {
        managed.wakeNotice = "a newer wake notice";
        settleTurn(managed);
      }),
    );
    managed.wakeNotice = WAKE_NOTE;
    enqueue(managed, "msg-1", "first");

    await flushQueue("agent-1");

    expect(managed.wakeNotice).toBe("a newer wake notice");
  });
});
