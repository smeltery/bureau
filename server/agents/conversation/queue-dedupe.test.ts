import { afterEach, describe, expect, test } from "bun:test";

import { DEFAULT_AGENT_CAPABILITIES, type AgentInfo } from "../../../shared/types.ts";
import type { BackendSession } from "../../backends/types.ts";
import { createManagedAgent } from "../managed-factory.ts";
import { agents, logCache, persistAll, type ManagedAgent } from "../state.ts";
import { enqueueMessage } from "./message-queue.ts";

afterEach(() => {
  agents.clear();
  logCache.clear();
  persistAll();
});

function makeAgent(id: string): ManagedAgent {
  const info: AgentInfo = {
    id,
    name: "Queue Dedupe Test",
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
    state: "thinking",
    topic: null,
    topicStale: false,
    customInstructions: null,
    queue: [],
  };
  const session = {
    send: async () => {},
    close: async () => {},
    stream: async function* () {},
  } as unknown as BackendSession;
  const managed = createManagedAgent({ info, skillCwd: process.cwd() });
  managed.session = session;
  managed.sessionId = "sess-1";
  agents.set(id, managed);
  return managed;
}

const peerSender = { kind: "agent" as const, agentId: "peer", agentName: "Peer", roomName: "Room 1" };

describe("enqueueMessage clientMessageId TTL", () => {
  test("retries are reserved for five minutes after accept", () => {
    const managed = makeAgent("agent-1");

    const first = enqueueMessage("agent-1", { sender: peerSender, text: "hello", clientMessageId: "retry-1" });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.queued).toBe(true);
    expect(managed.messageQueue).toHaveLength(1);
    expect(managed.queueDedupe.has("retry-1")).toBe(true);

    const whileQueued = enqueueMessage("agent-1", { sender: peerSender, text: "hello", clientMessageId: "retry-1" });
    expect(whileQueued).toEqual({ ok: true, queued: true, messageId: first.messageId });
    expect(managed.messageQueue).toHaveLength(1);

    managed.messageQueue = [];
    const afterFlush = enqueueMessage("agent-1", { sender: peerSender, text: "hello again", clientMessageId: "retry-1" });
    expect(afterFlush).toEqual({ ok: true, queued: false, messageId: first.messageId });
    expect(managed.messageQueue).toHaveLength(0);
  });

  test("reservation is per-receiver", () => {
    makeAgent("agent-a");
    const b = makeAgent("agent-b");

    expect(enqueueMessage("agent-a", { sender: peerSender, text: "to a", clientMessageId: "shared-key" }).ok).toBe(true);
    const toB = enqueueMessage("agent-b", { sender: peerSender, text: "to b", clientMessageId: "shared-key" });
    expect(toB.ok).toBe(true);
    if (!toB.ok) return;
    expect(toB.queued).toBe(true);
    expect(b.messageQueue).toHaveLength(1);
  });
});
