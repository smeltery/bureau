import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync, truncateSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { bureauError, bureauTurnFailure } from "../../backends/session-types.ts";
import { displayLogContent, logMessage, logContent, type LogMessage } from "../../../shared/i18n/log-message.ts";
import { cronjobRunStreamId, type CronjobRun, type LogEntry } from "../../../shared/types.ts";
import type { BackendSession, NormalizedEvent } from "../../backends/types.ts";
import { getBackend } from "../../backends/index.ts";
import { appendRun, appendRunLog, findRun, loadRunLog, updateRun } from "../../persistence.ts";
import { emitRunDiffWithDeps, emitRunReadFileWithDeps } from "../run-affordances.ts";
import { processNormalizedEvent, type ActiveRun } from "../run-events.ts";
import { runConsumerWithDeps, startRunHardTimeout, writeAffordanceLogWithDeps, type RunLifecycleDeps } from "../run-lifecycle.ts";
import { editRunMessageWithDeps, sendRunMessageWithDeps, type RunContinuationDeps } from "../run-continuation.ts";
import { editRunMessageWithDeps as editCore, type EditRunMessageDeps } from "../run-edit.ts";

const directories: string[] = [];
afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

function fixture() {
  const cwd = mkdtempSync(join(tmpdir(), "bureau-run-notice-"));
  directories.push(cwd);
  const id = crypto.randomUUID();
  const run: CronjobRun = {
    id,
    cronjobId: id,
    cronjobName: "Original schedule",
    trigger: "manual",
    status: "running",
    startedAt: Date.now(),
    endedAt: null,
    errorReason: null,
    promptSnapshot: "Original prompt",
    agentTypeSnapshot: "codex",
    modelFamilySnapshot: "gpt-5.6-sol",
    effortSnapshot: "high",
    cwdSnapshot: cwd,
    permissionModeSnapshot: "bypassPermissions",
    rootSessionId: "pending-" + id,
    previewText: "",
  };
  appendRun(id, run);
  const session: BackendSession = {
    async *stream() {
      yield* [] as NormalizedEvent[];
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
  const active: ActiveRun = {
    jobId: id,
    runId: id,
    streamId: cronjobRunStreamId(id),
    session,
    sessionId: null,
    rootSessionId: run.rootSessionId,
    consumerPromise: Promise.resolve(),
    hardTimeoutTimer: null,
    lastWrittenEntryId: null,
    lastAssistantText: "",
    trigger: "manual",
    killed: false,
    pendingEntries: [],
    isResume: false,
  };
  const entries: LogEntry[] = [];
  const deps: RunLifecycleDeps = {
    activeRuns: new Map([[id, active]]),
    emitEvent(event) {
      if (event.type === "log_entry") entries.push(event.entry);
    },
    hardTimeoutMs: 1,
  };
  const continuation: RunContinuationDeps = {
    activeRuns: new Map(),
    startingRuns: new Set(),
    getCronjobs: () => [],
    buildSystemPrompt: () => "",
    lifecycleDeps: () => deps,
    runConsumer: async () => {},
    finalizeRun: () => {},
    emitEvent: deps.emitEvent,
  };
  return { cwd, id, run, active, entries, deps, continuation };
}

function expectTranslated(entry: LogEntry, key: LogMessage["key"], literal?: string) {
  expect(entry.message?.key).toBe(key);
  for (const language of ["es", "ca", "zh"] as const) {
    const text = displayLogContent(entry, language);
    expect(text).not.toBe(entry.content);
    if (literal) expect(text).toContain(literal);
  }
}

test("run events translate unattended approvals and compaction without changing provider errors", () => {
  const f = fixture();
  const events: NormalizedEvent[] = [
    { kind: "approval_request", approvalId: "original", toolName: "Original tool {value}", input: {} },
    { kind: "compacted", summary: "Original summary {value}" },
    { kind: "turn_completed", status: "interrupted" },
    { kind: "error", message: "Original provider error {value}" },
  ];
  for (const event of events) processNormalizedEvent(f.active, event, f.deps.emitEvent);
  expectTranslated(f.entries[0], "logs.run.approval", "Original tool {value}");
  expectTranslated(f.entries[1], "logs.session.compactedSummary", "Original summary {value}");
  expectTranslated(f.entries[2], "logs.run.stopped", "interrupted");
  expect(f.entries[2].content).toBe("Run stopped: interrupted.");
  expect(f.entries[3].message).toBeUndefined();
  expect(displayLogContent(f.entries[3], "zh")).toBe("Original provider error {value}");
});

test("stream failures persist translated logs while retaining canonical terminal status", async () => {
  const f = fixture();
  f.active.session.stream = async function* () {
    yield { kind: "assistant_text", text: "Original response" };
    throw new Error("Original transport detail");
  };
  await runConsumerWithDeps(f.deps, f.active);
  const run = findRun(f.id, f.id)!;
  expect(run.status).toBe("failed");
  expect(run.errorReason).toBe("Stream error: Original transport detail");
  expect(run.previewText).toBe("Original response");
  expect(f.deps.activeRuns.size).toBe(0);
  const entries = loadRunLog(f.id, f.id, f.run.rootSessionId);
  expectTranslated(entries.at(-1)!, "logs.diagnostic.streamError", "Original transport detail");
  expect(entries[0].message).toBeUndefined();
});

test("hard timeout still kills the run and records the original failure reason", async () => {
  const f = fixture();
  startRunHardTimeout(f.deps, f.active);
  await new Promise((resolve) => setTimeout(resolve, 20));
  expect(f.active.killed).toBe(true);
  expect(f.active.hardTimeoutTimer).toBeNull();
  expect(findRun(f.id, f.id)).toMatchObject({ status: "timed_out", errorReason: "exceeded global run timeout" });
  expectTranslated(loadRunLog(f.id, f.id, f.run.rootSessionId)[0], "logs.run.timeout");
});

test("resume and edit preflights persist translated notices without starting sessions", async () => {
  const f = fixture();
  for (const [patch, resumeKey, editKey] of [
    [{ status: "skipped" }, "logs.run.resumeSkipped", "logs.run.editSkipped"],
    [{ status: "failed" }, "logs.run.resumeNoInit", "logs.run.editNoInit"],
    [{ rootSessionId: "actual-session", cwdSnapshot: join(f.cwd, "missing") }, "logs.run.resumeCwd", "logs.run.editCwd"],
  ] as const) {
    updateRun(f.id, f.id, patch);
    await sendRunMessageWithDeps(f.continuation, f.id, f.id, "Original follow-up");
    await editRunMessageWithDeps(f.continuation, f.id, f.id, "message", "Original edit");
    expectTranslated(f.entries.at(-2)!, resumeKey);
    expectTranslated(f.entries.at(-1)!, editKey);
    expect(f.continuation.activeRuns.size).toBe(0);
    expect(f.continuation.startingRuns.size).toBe(0);
  }
  const stored = loadRunLog(f.id, f.id, "actual-session");
  expect(stored.map((entry) => entry.message?.key)).toEqual(["logs.run.resumeCwd", "logs.run.editCwd"]);
});

test("scheduled file and diff feedback preserves paths, payloads and locale numbers", () => {
  const f = fixture();
  const write: Parameters<typeof emitRunReadFileWithDeps>[1] = (...args) => writeAffordanceLogWithDeps(f.deps, ...args);
  const missing = join(f.cwd, "original missing.txt");
  expect(emitRunReadFileWithDeps(f.deps.activeRuns, write, f.id, f.id, missing)).toEqual({ ok: true });
  expectTranslated(f.entries.at(-1)!, "logs.command.missingFile", missing);
  const directory = join(f.cwd, "directory");
  mkdirSync(directory);
  emitRunReadFileWithDeps(f.deps.activeRuns, write, f.id, f.id, directory);
  expectTranslated(f.entries.at(-1)!, "logs.command.notFile", directory);
  const large = join(f.cwd, "large.bin");
  writeFileSync(large, "");
  truncateSync(large, 21.5 * 1024 * 1024);
  emitRunReadFileWithDeps(f.deps.activeRuns, write, f.id, f.id, large);
  expect(f.entries.at(-1)!.content).toContain("21.5 MB");
  expect(displayLogContent(f.entries.at(-1)!, "es")).toContain("21,5 MB");
  emitRunDiffWithDeps(f.deps.activeRuns, write, f.id, f.id);
  expectTranslated(f.entries.at(-1)!, "logs.command.notRepository", f.cwd);
  expect(Bun.spawnSync(["git", "init", "-q", f.cwd], { env: process.env }).exitCode).toBe(0);
  rmSync(large);
  rmSync(directory, { recursive: true });
  emitRunDiffWithDeps(f.deps.activeRuns, write, f.id, f.id);
  expectTranslated(f.entries.at(-1)!, "logs.command.cleanTree", f.cwd);
  emitRunDiffWithDeps(f.deps.activeRuns, write, f.id, f.id, undefined, "original-missing-commit");
  expectTranslated(f.entries.at(-1)!, "logs.action.badCommit", "original-missing-commit");
  const small = join(f.cwd, "original.txt");
  writeFileSync(small, "Original file content");
  emitRunReadFileWithDeps(f.deps.activeRuns, write, f.id, f.id, small);
  expect(f.entries.at(-1)!.kind).toBe("file-view");
  expect(f.entries.at(-1)!.content).toBe("original.txt");
  expect(f.entries.at(-1)!.message).toBeUndefined();
  expect(f.entries.at(-1)!.attachments).toHaveLength(1);
});

test("edit history failures preserve provider details in translated feedback", async () => {
  const f = fixture();
  const messages: (string | LogMessage)[] = [];
  const deps: EditRunMessageDeps = {
    cronRunBackend: () => ({
      ...getBackend("codex"),
      getSessionMessages: async () => {
        throw new Error("Original history failure");
      },
    }),
    buildRunResumeOptions: () => ({ agentId: f.id, systemPrompt: "", effort: "high", cwd: f.cwd, modelFamily: "gpt-5.6-sol", permissionMode: "never" }),
    emitRunErrorEntry: (_job, _run, message) => messages.push(message),
    installResumedActive: () => f.active,
    finalizeRun: () => {},
    revokeRunToken: () => {},
    emitEvent: () => {},
  };
  await editCore(deps, f.run, "missing", "edited", f.run.rootSessionId);
  expectTranslated({ kind: "error", ...logContent(messages[0]) } as LogEntry, "logs.action.editMissing");
  appendRunLog(f.id, f.id, f.run.rootSessionId, { id: "message", agentId: f.active.streamId, timestamp: Date.now(), kind: "user_message", content: "Original message" });
  await editCore(deps, f.run, "message", "edited", f.run.rootSessionId);
  expectTranslated({ kind: "error", ...logContent(messages[1]) } as LogEntry, "logs.run.loadFailed", "Original history failure");
  deps.cronRunBackend = () => ({
    ...getBackend("codex"),
    getSessionMessages: async () => {
      throw { message: { detail: "Original provider detail" } };
    },
  });
  await editCore(deps, f.run, "message", "edited", f.run.rootSessionId);
  expect(logContent(messages[2]).content).toBe("Failed to load session messages: [object Object]");
});

test("preflight errors redact both English text and translated parameters before emission", async () => {
  const f = fixture();
  const secret = "sk-proj-" + "Q".repeat(24);
  updateRun(f.id, f.id, { rootSessionId: "actual-session", cwdSnapshot: join(f.cwd, secret) });
  await sendRunMessageWithDeps(f.continuation, f.id, f.id, "follow-up");
  const entry = f.entries[0];
  expect(JSON.stringify(entry)).not.toContain(secret);
  expect(entry.content).toContain("sk-proj-...REDACTED");
  expect(displayLogContent(entry, "es")).toContain("sk-proj-...REDACTED");
  expect(loadRunLog(f.id, f.id, "actual-session")[0]).toEqual(entry);
});

test("backend failure metadata survives scheduled-run persistence without changing status or error reason", async () => {
  for (const terminal of [bureauTurnFailure(logMessage("logs.provider.rateLimit")), bureauError(logMessage("logs.backend.streamFailed", { error: "Original detail {value}" }))]) {
    const f = fixture();
    f.active.session.stream = async function* () {
      yield { kind: "system_init", sessionId: "original-session" } as const;
      yield terminal;
    };
    await runConsumerWithDeps(f.deps, f.active);
    const errors = f.entries.filter((entry) => entry.kind === "error");
    expect(errors).toHaveLength(1);
    expectTranslated(errors[0], terminal.errorMessage!.key, terminal.kind === "error" ? "Original detail {value}" : undefined);
    expect(findRun(f.id, f.id)).toMatchObject({ status: "failed", errorReason: terminal.kind === "error" ? terminal.message : terminal.error });
    expect(loadRunLog(f.id, f.id, "original-session").filter((entry) => entry.kind === "error")).toEqual(errors);
  }
});

test("scheduled provider errors ignore untrusted translation metadata", () => {
  const f = fixture();
  const errorMessage = logMessage("logs.provider.auth");
  processNormalizedEvent(f.active, { kind: "error", message: "Original failure", errorMessage }, f.deps.emitEvent);
  processNormalizedEvent(f.active, { kind: "turn_completed", status: "failed", error: "Original completion", errorMessage }, f.deps.emitEvent);
  expect(f.entries.map((entry) => displayLogContent(entry, "zh"))).toEqual(["Original failure", "Original completion"]);
  expect(f.entries.every((entry) => entry.message === undefined)).toBe(true);
});
