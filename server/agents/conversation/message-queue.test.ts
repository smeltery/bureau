import { afterEach, describe, expect, test } from "bun:test";

import { DEFAULT_AGENT_CAPABILITIES, type AgentInfo } from "../../../shared/types.ts";
import type { BackendSession } from "../../backends/types.ts";
import { createManagedAgent } from "../managed-factory.ts";
import { agents, logCache, persistAll, type ManagedAgent } from "../state.ts";
import { enqueueMessage, flushQueue } from "./message-queue.ts";

afterEach(() => {
  agents.clear();
  logCache.clear();
  // enqueueMessage/flushQueue persistAll() test agents into the real
  // BUREAU_DIR. Re-persist the cleared map so a later test file whose import
  // graph boots the server (e.g. ws/agent-commands.test.ts → ../index.ts)
  // doesn't restore this file's agents into the shared map mid-suite.
  persistAll();
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

const peerSender = { kind: "agent" as const, agentId: "peer-1", agentName: "Peer", roomName: "Lobby" };

async function settleAsyncWork() {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe("enqueueMessage steering", () => {
  test("plain sends never carry steer fields", () => {
    const managed = makeAgent(
      "agent-1",
      fakeSession(() => {}),
    );
    managed.info.state = "thinking";

    const result = enqueueMessage("agent-1", { sender: peerSender, text: "no steer" });

    expect(result).toEqual({ ok: true, queued: true, messageId: expect.any(String) });
  });

  test("steer at an idle receiver delivers now and reports steered:false", async () => {
    const sent: string[] = [];
    const managed = makeAgent(
      "agent-1",
      fakeSession((text) => {
        sent.push(text);
        settleTurn(managed);
      }),
    );

    const result = enqueueMessage("agent-1", { sender: peerSender, text: "hello" }, { steer: true });
    await settleAsyncWork();

    expect(result).toEqual({ ok: true, queued: false, messageId: expect.any(String), steered: false });
    expect(managed.recentSteers).toEqual([]);
    expect(sent).toHaveLength(1);
  });

  test("steer interrupts a busy receiver and records the interruption", async () => {
    const sent: string[] = [];
    const managed = makeAgent(
      "agent-1",
      fakeSession((text) => {
        sent.push(text);
        settleTurn(managed);
      }),
    );
    managed.info.state = "thinking";

    const result = enqueueMessage("agent-1", { sender: peerSender, text: "urgent" }, { steer: true });
    await settleAsyncWork();

    expect(result).toEqual({ ok: true, queued: false, messageId: expect.any(String), steered: true });
    expect(managed.recentSteers).toHaveLength(1);
    expect(managed.messageQueue).toEqual([]);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toContain("urgent");
  });

  test("steer mid multi-step flow degrades to a plain queue", () => {
    const managed = makeAgent(
      "agent-1",
      fakeSession(() => {}),
    );
    managed.info.state = "thinking";
    managed.pendingPermission = { approvalId: "appr-1", toolName: "Bash" };

    const result = enqueueMessage("agent-1", { sender: peerSender, text: "wait your turn" }, { steer: true });

    expect(result).toEqual({ ok: true, queued: true, messageId: expect.any(String), steered: false, steerDeclined: "multi_step_flow" });
    expect(managed.recentSteers).toEqual([]);
    expect(managed.messageQueue).toHaveLength(1);
  });

  test("steers over the rate limit degrade to a plain queue", () => {
    const managed = makeAgent(
      "agent-1",
      fakeSession(() => {}),
    );
    managed.info.state = "thinking";
    managed.recentSteers = [Date.now(), Date.now(), Date.now()];

    const result = enqueueMessage("agent-1", { sender: peerSender, text: "one too many" }, { steer: true });

    expect(result).toEqual({ ok: true, queued: true, messageId: expect.any(String), steered: false, steerDeclined: "rate_limited" });
    expect(managed.recentSteers).toHaveLength(3);
    expect(managed.messageQueue).toHaveLength(1);
  });

  test("stale steer stamps age out of the rate-limit window", () => {
    const sent: string[] = [];
    const managed = makeAgent(
      "agent-1",
      fakeSession((text) => {
        sent.push(text);
        settleTurn(managed);
      }),
    );
    managed.info.state = "thinking";
    const stale = Date.now() - 61_000;
    managed.recentSteers = [stale, stale, stale];

    const result = enqueueMessage("agent-1", { sender: peerSender, text: "window rolled" }, { steer: true });

    expect(result).toEqual({ ok: true, queued: false, messageId: expect.any(String), steered: true });
    expect(managed.recentSteers).toHaveLength(1);
    expect(managed.recentSteers[0]!).toBeGreaterThan(stale);
  });
});
