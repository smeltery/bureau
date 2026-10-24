import { createSummaryRunner } from "./runtime.ts";
import { readAgentLogs } from "../log-reader.ts";
import { afterEach, expect, spyOn, test } from "bun:test";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { DEFAULT_AGENT_CAPABILITIES, type LogEntry } from "../../../shared/types.ts";
import type { BackendSession, NormalizedEvent } from "../../backends/types.ts";
import { LOGS_DIR } from "../../persistence/paths.ts";
import { kill } from "../lifecycle-kill.ts";
import { createManagedAgent } from "../managed-factory.ts";
import { runConsumer } from "../session/event-consumer.ts";
import { addLogEntry, agents, logCache } from "../state.ts";
import { persistCurrentSessionTopic } from "../topic.ts";
import { installSummaryRequests, recordSummaryEntry, requestSessionSummary } from "./activity.ts";

const cleanup: (() => void)[] = [];
afterEach(() => {
  for (const restore of cleanup.splice(0).reverse()) restore();
});

function fixture(sessionId: string | null = "first") {
  const id = `summary-activity-${crypto.randomUUID()}`;
  const managed = createManagedAgent({
    info: {
      id,
      name: "Summary test",
      desk: 0,
      room: 0,
      cwd: process.cwd(),
      agentType: "codex",
      modelFamily: "test",
      permissionMode: "default",
      outfit: { hat: "none", color: "#000000", hair: "#000000", hairStyle: "short", skin: "#000000", beard: "none", accessory: null },
      capabilities: DEFAULT_AGENT_CAPABILITIES,
      state: "idle",
      topic: null,
      topicStale: false,
      customInstructions: null,
    },
    skillCwd: process.cwd(),
    sessionId,
    slashCommands: [],
    skills: [],
  });
  agents.set(id, managed);
  cleanup.push(() => {
    agents.delete(id);
    logCache.delete(id);
    rmSync(join(LOGS_DIR, id), { recursive: true, force: true });
  });
  return managed;
}

async function consume(managed: ReturnType<typeof fixture>, events: NormalizedEvent[]) {
  const session: BackendSession = {
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
  managed.session = session;
  await runConsumer(managed.info.id, managed, session);
}

test("persisted conversation entries trigger once at a turn boundary", async () => {
  const managed = fixture();
  const requests: string[] = [];
  cleanup.push(installSummaryRequests((_, session) => requests.push(session)));
  for (let i = 0; i < 39; i++) addLogEntry(managed.info.id, "text", "Conversation");
  for (let i = 0; i < 50; i++) addLogEntry(managed.info.id, "tool_result", "Tool output");
  await consume(managed, [{ kind: "turn_completed", status: "completed" }]);
  expect(requests).toEqual([]);
  addLogEntry(managed.info.id, "api_token_outbound", "API conversation");
  expect(requests).toEqual([]);
  await consume(managed, [{ kind: "turn_completed", status: "completed" }]);
  expect(requests).toEqual(["first"]);
  await consume(managed, [{ kind: "turn_completed", status: "completed" }]);
  expect(requests).toEqual(["first"]);
});

test("session switches capture the old session and reset rolling activity", () => {
  const managed = fixture();
  const requests: { session: string; model: string }[] = [];
  cleanup.push(installSummaryRequests((target, session) => requests.push({ session, model: target.info.modelFamily })));
  for (let i = 0; i < 39; i++) addLogEntry(managed.info.id, "user_message", "Question");
  persistCurrentSessionTopic(managed.info.id, managed);
  managed.sessionId = "second";
  managed.info.modelFamily = "changed";
  addLogEntry(managed.info.id, "text", "New conversation");
  requestSessionSummary(managed);
  expect(requests).toEqual([{ session: "first", model: "test" }]);
  managed.sessionId = "first";
  requestSessionSummary(managed);
  expect(requests).toHaveLength(1);
  requestSessionSummary(managed, true);
  expect(requests.at(-1)).toEqual({ session: "first", model: "changed" });
});

test("initial cached messages count after session creation, while replay alone does not", async () => {
  const managed = fixture(null);
  const requests: string[] = [];
  cleanup.push(installSummaryRequests((_, session) => requests.push(session)));
  for (let i = 0; i < 40; i++) addLogEntry(managed.info.id, "text", "Before initialization");
  requestSessionSummary(managed);
  expect(requests).toEqual([]);
  await consume(managed, [
    { kind: "system_init", sessionId: "created" },
    { kind: "turn_completed", status: "completed" },
  ]);
  expect(requests).toEqual(["created"]);
  const resumed = fixture("created");
  logCache.set(resumed.info.id, logCache.get(managed.info.id)!);
  await consume(resumed, [
    { kind: "system_init", sessionId: "created" },
    { kind: "turn_completed", status: "completed" },
  ]);
  expect(requests).toEqual(["created"]);
});

test("failed disk writes and ephemeral entries do not advance summary activity", () => {
  const managed = fixture();
  const requests: string[] = [];
  cleanup.push(installSummaryRequests((_, session) => requests.push(session)));
  mkdirSync(join(LOGS_DIR, managed.info.id, "first.jsonl"), { recursive: true });
  const diagnostic = spyOn(console, "error").mockImplementation(() => {});
  cleanup.push(() => diagnostic.mockRestore());
  for (let i = 0; i < 40; i++) {
    addLogEntry(managed.info.id, "text", "Cannot persist");
    recordSummaryEntry(managed, { kind: "text", ephemeral: true } as LogEntry);
  }
  requestSessionSummary(managed);
  expect(requests).toEqual([]);
  cleanup.push(
    installSummaryRequests(() => {
      throw new Error("Private provider details");
    }),
  );
  expect(() => requestSessionSummary(managed, true)).not.toThrow();
  expect(diagnostic.mock.calls.at(-1)).toEqual(["Could not request conversation summary"]);
});

test("backend session replacement and agent removal request the outgoing history", async () => {
  const managed = fixture();
  const requests: string[] = [];
  cleanup.push(
    installSummaryRequests((target, session) => {
      expect(agents.get(target.info.id)).toBe(managed);
      expect(target.sessionId).toBe(session);
      requests.push(session);
    }),
  );
  await consume(managed, [{ kind: "system_init", sessionId: "replacement" }]);
  expect(requests).toEqual(["first"]);
  await kill(managed.info.id);
  expect(requests).toEqual(["first", "replacement"]);
  expect(agents.has(managed.info.id)).toBe(false);
});

test("turn completion returns before generation and publishes searchable history afterward", async () => {
  const managed = fixture();
  let finish!: (text: string) => void;
  const pending: Promise<void>[] = [];
  const run = createSummaryRunner({
    environment: () => ({ env: {} }),
    backend: () => ({
      capabilities: DEFAULT_AGENT_CAPABILITIES,
      getModelOptions: () => [],
      oneShotPrompt: () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    }),
  });
  cleanup.push(
    installSummaryRequests((target, session) => {
      pending.push(run(target, session));
    }),
  );
  for (let i = 0; i < 40; i++) addLogEntry(managed.info.id, "text", "Persisted conversation");
  await consume(managed, [{ kind: "turn_completed", status: "completed" }]);
  expect(pending).toHaveLength(1);
  expect(readAgentLogs(managed.info.id, new URLSearchParams("q=deployment"))).toMatchObject({ ok: true, body: { summaryHits: [] } });
  finish("Resolved deployment failure");
  await Promise.all(pending);
  expect(readAgentLogs(managed.info.id, new URLSearchParams("q=deployment"))).toMatchObject({
    ok: true,
    body: { results: [], summaryHits: [{ sessionId: "first", snippet: "Resolved deployment failure" }] },
  });
});
