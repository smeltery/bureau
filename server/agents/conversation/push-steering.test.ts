import { afterEach, expect, test } from "bun:test";
import { createManagedAgent } from "../managed-factory.ts";
import { agents, logCache, persistAll } from "../state.ts";
import { loadAgents } from "../../persistence.ts";
import { runConsumer } from "../session/event-consumer.ts";
import { enqueueMessage, dequeueMessage } from "./message-queue.ts";
import { unclaimedQueue } from "./boundary-delivery.ts";
import { pushBoundarySteer, recordSteerDelivery } from "./push-steering.ts";
import type { AgentInfo } from "../../../shared/types.ts";
import type { BackendSession, NormalizedEvent } from "../../backends/types.ts";

afterEach(() => {
  agents.clear();
  logCache.clear();
  persistAll();
});
function fixture(steer: NonNullable<BackendSession["steer"]>) {
  let interrupted = false;
  const managed = createManagedAgent({
    info: { id: "steered", name: "Receiver", userId: "owner", agentType: "codex", state: "tool_executing", room: 0, desk: 0, cwd: process.cwd(), autoHandoff: false } as AgentInfo,
    skillCwd: process.cwd(),
    slashCommands: [],
    skills: [],
  });
  managed.session = {
    steer,
    async *stream() {},
    async send() {
      throw new Error("unexpected send");
    },
    async getContextUsage() {
      return null;
    },
    async approve() {},
    async abort() {
      interrupted = true;
    },
    close() {
      interrupted = true;
    },
    canAbortInPlace() {
      return true;
    },
  };
  managed.pendingTurn = { promise: Promise.resolve(), resolve() {}, reject() {}, anchorEntryId: null };
  agents.set("steered", managed);
  return { managed, interrupted: () => interrupted };
}
const peer = { kind: "agent" as const, agentId: "peer", agentName: "Peer", roomName: "Room" };
const offer = (text = "guidance") => enqueueMessage("steered", { sender: peer, text }, { steer: true });
const tick = () => Promise.resolve();
async function deliver(event: NormalizedEvent) {
  const managed = agents.get("steered")!;
  const session = managed.session!;
  session.stream = async function* () {
    yield event;
  };
  await runConsumer("steered", managed, session);
}

test("a steer stays persisted until recorded, with one attributed log and no interruption", async () => {
  const calls: { text: string; id: string }[] = [];
  const { managed, interrupted } = fixture(async (text, id) => {
    calls.push({ text, id });
    return true;
  });
  const result = offer();
  expect(result).toMatchObject({ ok: true, queued: true, steered: true });
  expect(calls).toHaveLength(1);
  expect(calls[0].text).toContain("guidance");
  expect(calls[0].text).toContain("agent id: peer");
  expect(managed.messageQueue).toHaveLength(1);
  expect(unclaimedQueue(managed)).toHaveLength(0);
  expect(
    loadAgents()
      .flatMap((room) => room.agents)
      .find((agent) => agent.id === "steered")?.queue,
  ).toHaveLength(1);
  expect(dequeueMessage("steered", managed.messageQueue[0].id)).toBe(false);
  expect(logCache.get("steered") ?? []).toHaveLength(0);
  await deliver({ kind: "steer_delivered", steerId: calls[0].id });
  await deliver({ kind: "steer_delivered", steerId: calls[0].id });
  expect(managed.messageQueue).toHaveLength(0);
  expect(logCache.get("steered")).toHaveLength(1);
  expect(logCache.get("steered")![0].metadata).toMatchObject({ sender_agent_id: "peer", delivery: "turn_steer" });
  expect(
    loadAgents()
      .flatMap((room) => room.agents)
      .find((agent) => agent.id === "steered")?.queue,
  ).toHaveLength(0);
  await deliver({ kind: "turn_completed", status: "failed", error: "Stopped" });
  expect(managed.messageQueue).toHaveLength(0);
  expect(interrupted()).toBe(false);
  await tick();
});

test("refused and unrecorded messages remain queued at turn end", async () => {
  let accept = false;
  const ids: string[] = [];
  const { managed } = fixture(async (_, id) => {
    ids.push(id);
    return accept;
  });
  offer();
  await tick();
  expect(unclaimedQueue(managed)).toHaveLength(1);
  accept = true;
  pushBoundarySteer("steered");
  expect(ids).toHaveLength(2);
  expect(unclaimedQueue(managed)).toHaveLength(0);
  await deliver({ kind: "turn_completed", status: "completed" });
  expect(unclaimedQueue(managed)).toHaveLength(1);
  expect(managed.boundaryClaim).toBeNull();
  recordSteerDelivery("steered", ids[1]);
  expect(managed.messageQueue).toHaveLength(1);
});

test("a late refusal cannot release another session's claim", async () => {
  let refuse!: (value: boolean) => void;
  const { managed } = fixture(() => new Promise((resolve) => (refuse = resolve)));
  offer();
  managed.session = { ...managed.session!, steer: async () => true };
  pushBoundarySteer("steered");
  const claim = managed.boundaryClaim;
  refuse(false);
  await tick();
  expect(managed.boundaryClaim).toBe(claim);
  expect(unclaimedQueue(managed)).toHaveLength(0);
});

test("mixed human queues, permission prompts and stopped transitions never push", () => {
  let calls = 0;
  const { managed, interrupted } = fixture(async () => {
    calls++;
    return true;
  });
  managed.messageQueue.push({ id: "human", sender: { kind: "user", username: "Owner" }, text: "first", queuedAt: 1 });
  offer();
  expect(calls).toBe(0);
  managed.messageQueue.shift();
  managed.pendingPermission = {} as typeof managed.pendingPermission;
  pushBoundarySteer("steered");
  expect(calls).toBe(0);
  managed.pendingPermission = null;
  managed.aborting = true;
  pushBoundarySteer("steered");
  expect(calls).toBe(0);
  expect(interrupted()).toBe(false);
});

test("a main-thread tool call retries an early refusal without interrupting", async () => {
  const ids: string[] = [];
  const { managed, interrupted } = fixture(async (_, id) => {
    ids.push(id);
    return ids.length > 1;
  });
  offer();
  await tick();
  await deliver({ kind: "tool_call", name: "shell", toolUseId: "child", input: {}, subagent: { parentToolUseId: "worker" } });
  expect(ids).toHaveLength(1);
  await deliver({ kind: "tool_call", name: "shell", toolUseId: "parent", input: {} });
  expect(ids).toHaveLength(2);
  await deliver({ kind: "steer_delivered", steerId: ids[1] });
  expect(managed.messageQueue).toHaveLength(0);
  expect(interrupted()).toBe(false);
});

test("receipts during abort drain only their batch and leave uncertain input queued", async () => {
  const ids: string[] = [];
  const { managed } = fixture(async (_, id) => {
    ids.push(id);
    return true;
  });
  offer("first");
  offer("second");
  expect(ids).toHaveLength(2);
  managed.aborting = true;
  await deliver({ kind: "steer_delivered", steerId: ids[1] });
  expect(managed.messageQueue.map((item) => item.text)).toEqual(["first"]);
  await deliver({ kind: "turn_completed", status: "interrupted" });
  expect(unclaimedQueue(managed).map((item) => item.text)).toEqual(["first"]);
  expect(
    logCache
      .get("steered")
      ?.filter((entry) => entry.kind === "user_message")
      .map((entry) => entry.content),
  ).toEqual(["second"]);
});
