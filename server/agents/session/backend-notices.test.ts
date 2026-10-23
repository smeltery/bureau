import { applyOpenCodeEvent } from "../../backends/opencode/transport-events.ts";
import { OpenCodeTurnAccounting } from "../../backends/opencode/connection/turn-accounting.ts";
import { translateCompletedItem } from "../../backends/codex/completed-items.ts";
import { afterEach, expect, test } from "bun:test";
import { displayLogContent, logMessage } from "../../../shared/i18n/log-message.ts";
import { DEFAULT_AGENT_CAPABILITIES, type AgentInfo, type LogEntry } from "../../../shared/types.ts";
import type { BackendSession, NormalizedEvent } from "../../backends/types.ts";
import { applyAllowPrefix } from "../../backends/codex/prefix-rule-notices.ts";
import { SessionPrefixRules } from "../../backends/codex/prefix-rules.ts";
import { codexSubprocessExitEvent } from "../../backends/codex/session-process-events.ts";
import { processNormalizedEvent, type ActiveRun } from "../../cronjobs/run-events.ts";
import { loadRunLog } from "../../persistence.ts";
import { createManagedAgent } from "../managed-factory.ts";
import { agents, logCache } from "../state.ts";
import { runConsumer } from "./event-consumer.ts";

afterEach(() => {
  agents.clear();
  logCache.clear();
});

function agentInfo(id: string, agentType: AgentInfo["agentType"] = "claude"): AgentInfo {
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
    agentType,
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

test("normal and scheduled logs retain translated backend notices through persistence", async () => {
  const id = "backend-notices-" + crypto.randomUUID();
  const events: NormalizedEvent[] = [];
  applyAllowPrefix(new SessionPrefixRules(), { suggestedPrefix: ["grep", "401"], commandTokens: ["grep", "401", "log"], cwd: "/tmp/project` original" }, undefined, (event) => events.push(event));
  events.push(codexSubprocessExitEvent({ code: 7, signal: "SIGTERM", turnInFlight: false }));
  // Even valid translation metadata on external output must not opt it in.
  events.push({ kind: "system_text", text: "Original provider output {prefix}", message: logMessage("logs.backend.prefixAuto") });
  const session = eventSession(events);
  const managed = createManagedAgent({ info: agentInfo(id, "codex"), skillCwd: process.cwd(), slashCommands: [], skills: [] });
  managed.session = session;
  agents.set(id, managed);
  await runConsumer(id, managed, session);
  const normal = logCache.get(id)!;
  expect(normal).toHaveLength(3);
  expect(normal[0].message?.key).toBe("logs.backend.prefixGranted");
  expect(normal[1].content).toBe("Codex subprocess exited (code 7) (signal SIGTERM).");
  expect(normal[2].message).toBeUndefined();
  const active: ActiveRun = {
    jobId: id,
    runId: id,
    streamId: id,
    session,
    sessionId: null,
    rootSessionId: id,
    consumerPromise: Promise.resolve(),
    hardTimeoutTimer: null,
    lastWrittenEntryId: null,
    lastAssistantText: "",
    trigger: "manual",
    killed: false,
    pendingEntries: [],
    isResume: false,
  };
  const emitted: LogEntry[] = [];
  const emit = (event: Parameters<typeof processNormalizedEvent>[2] extends (event: infer E) => void ? E : never) => {
    if (event.type === "log_entry") emitted.push(event.entry);
  };
  for (const event of events) processNormalizedEvent(active, event, emit);
  expect(active.pendingEntries).toHaveLength(3);
  processNormalizedEvent(active, { kind: "system_init", sessionId: id }, emit);
  expect(active.pendingEntries).toHaveLength(0);
  const stored = loadRunLog(id, id, id);
  expect(stored).toHaveLength(3);
  for (const entries of [normal, emitted, stored]) {
    expect(entries[0].message?.key).toBe("logs.backend.prefixGranted");
    expect(entries[2].message).toBeUndefined();
    for (const language of ["es", "ca", "zh"] as const) {
      expect(displayLogContent(entries[0], language)).toContain("`grep 401`");
      expect(displayLogContent(entries[0], language)).toContain("``/tmp/project` original``");
      expect(displayLogContent(entries[0], language)).not.toBe(entries[0].content);
      expect(displayLogContent(entries[1], language)).toContain("SIGTERM");
      expect(displayLogContent(entries[2], language)).toBe("Original provider output {prefix}");
    }
  }
});

test("retry and compaction notices translate without exposing raw provider details", () => {
  const events: NormalizedEvent[] = [];
  const settled: NormalizedEvent[] = [];
  const accounting = new OpenCodeTurnAccounting();
  const ctx: Parameters<typeof applyOpenCodeEvent>[1] = {
    sink: (event) => events.push(event),
    settle: (event) => settled.push(event),
    abortRequested: false,
    autoApprove: false,
    replyPermission: async () => {},
    setPendingPermission: () => {},
    assistantMessages: new Set(),
    textByPart: new Map(),
    reasoningByPart: new Map(),
    tools: new Map(),
    seenPermissions: new Set(),
    accounting,
    onContext: () => {},
  };
  applyOpenCodeEvent({ kind: "retry", sessionId: "test", attempt: 2, message: "rate limit; private provider detail" }, ctx);
  applyOpenCodeEvent({ kind: "error", sessionId: "test", error: { name: "ContextOverflowError" } }, ctx);
  expect(accounting.overflowPending).toBe(true);
  expect(settled).toHaveLength(0);
  expect(events).toHaveLength(2);
  const active = { pendingEntries: [], sessionId: null, streamId: "retry-test" } as unknown as ActiveRun;
  for (const event of events) processNormalizedEvent(active, event, () => {});
  expect(active.pendingEntries[0].content).toBe("The model provider is rate limiting requests. Try again shortly. OpenCode retry 2.");
  expect(displayLogContent(active.pendingEntries[0], "es")).toContain("Reintento 2 de OpenCode");
  expect(displayLogContent(active.pendingEntries[0], "es")).toContain("limitando las solicitudes");
  expect(displayLogContent(active.pendingEntries[1], "zh")).toContain("正在压缩对话");
  expect(JSON.stringify(events)).not.toContain("private provider detail");
});

test("image failure wrappers translate while keeping provider details literal", () => {
  const events = translateCompletedItem({ type: "imageGeneration", status: "failed", result: "Original image error {value}" }, () => null);
  const active = { pendingEntries: [], sessionId: null, streamId: "image-test" } as unknown as ActiveRun;
  for (const event of events) processNormalizedEvent(active, event, () => {});
  const entry = active.pendingEntries[0];
  expect(entry.content).toBe("Codex image generation failed: Original image error {value}");
  for (const language of ["es", "ca", "zh"] as const) {
    expect(displayLogContent(entry, language)).not.toBe(entry.content);
    expect(displayLogContent(entry, language)).toContain("Original image error {value}");
  }
});
