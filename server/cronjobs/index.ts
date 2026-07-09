// Cronjob scheduler + per-run backend session lifecycle.
//
// Scheduler tick: every 60s, looks at every enabled cronjob and fires those
// whose nextFireAt has passed. Overlap rule: if a *scheduled* run is still
// in flight for the same cronjob, write a "skipped" row instead of firing.
// Manual "Run now" bypasses the overlap rule.
//
// Each fire creates a fresh backend session, sends the cronjob's prompt as the
// first user message, streams normalized output to a per-run JSONL log, and
// broadcasts log entries to the UI via the existing event bus. The synthetic
// "stream id" used for log routing is `cronjobRunStreamId(runId)`.

import { generateCronjobRunId, cronjobRunStreamId, type Attachment, type Cronjob, type CronjobRun, type LogEntry } from "../../shared/types.ts";
import {
  loadCronjobs,
  saveCronjobs,
  loadCronjobsPrompt,
  saveCronjobsPrompt,
  loadRuns,
  saveRuns,
  appendRun,
  updateRun,
  findRun,
  appendRunLog,
  loadRunLogWithAncestors,
  listAllCronjobIdsOnDisk,
} from "../persistence.ts";
import { claudeProjectDir, claudeSessionFileExists, validateCwd } from "../agents/session/paths.ts";
import type { BackendSession, CreateSessionOptions } from "../backends/types.ts";
import { getUserByName } from "../users.ts";
import { clampSchedule, computeNextFire } from "./schedule.ts";
import { mintRunToken, revokeRunToken } from "./tokens.ts";
import { buildCronjobMemoryPrompt, buildCronjobSystemPrompt as buildCronjobSystemPromptWithInstructions } from "./system-prompt.ts";
import { emitRunDiffWithDeps, emitRunReadFileWithDeps, type AffordanceActiveRun, type RunAffordanceResult } from "./run-affordances.ts";
import { readCronjobLifetimeUsage as readCronjobLifetimeUsageFromDisk } from "./usage.ts";
import { writeLog, type ActiveRun } from "./run-events.ts";
import { finalizeRunWithDeps, runConsumerWithDeps, startRunHardTimeout, writeAffordanceLogWithDeps, type RunLifecycleDeps } from "./run-lifecycle.ts";
import { addCronjobDefinition, deleteCronjobDefinition, updateCronjobDefinition, type AddCronjobInput, type UpdateCronjobChanges } from "./definitions.ts";
import { editRunMessageWithDeps } from "./run-edit.ts";
import {
  buildCronjobEnv,
  buildRunResumeOptions as buildRunResumeOptionsWithDeps,
  buildRunSessionOptions as buildRunSessionOptionsWithDeps,
  cronjobBackend,
  cronRunBackend,
  withRunTokenEnv,
} from "./session-options.ts";
// Re-exported so external callers can use the same scheduler math (kept for
// the public surface of this module before the refactor split it out).
export { computeNextFire };
export { buildCronjobMemoryPrompt };

function checkCronRunSessionFile(run: CronjobRun, leaf: string, action: "resume" | "edit"): boolean {
  if ((run.agentTypeSnapshot ?? "claude") !== "claude") return true;
  let env: { [key: string]: string | undefined } | undefined;
  try {
    const job = cronjobs.find((c) => c.id === run.cronjobId);
    env = buildCronjobEnv(job?.userId ?? null);
  } catch (err: any) {
    emitRunErrorEntry(run.cronjobId, run.id, `Cannot ${action}: env file is invalid: ${err.message || String(err)}`);
    return false;
  }
  if (claudeSessionFileExists(run.cwdSnapshot, leaf, env)) return true;

  const prefix = action === "resume" ? `Cannot resume session ${leaf.slice(0, 8)}…` : `Cannot edit: session ${leaf.slice(0, 8)}…`;
  emitRunErrorEntry(
    run.cronjobId,
    run.id,
    `${prefix}: its file is missing from ${claudeProjectDir(run.cwdSnapshot, env)}. ` +
      `Most commonly this happens after the cwd was moved or renamed — the Claude CLI stores sessions under a path derived from cwd.`,
  );
  return false;
}

// ---------------------------------------------------------------------------
// In-memory state
// ---------------------------------------------------------------------------

const activeRuns = new Map<string, ActiveRun>(); // runId -> ActiveRun

// Synchronously-claimed slot for runs whose resume/fork is mid-startup but
// hasn't reached `activeRuns.set` yet. Without this gate, a second concurrent
// send/edit call for the same runId would pass the activeRuns.has() check
// during the awaits in editRunMessage (getSessionMessages → forkSession),
// fork twice, and end up overwriting each other's ActiveRun entries.
const startingRuns = new Set<string>();

let cronjobs: Cronjob[] = [];
let cronjobsPrompt: string | null = null;

const HARD_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes
const TICK_INTERVAL_MS = 60 * 1000;

// ---------------------------------------------------------------------------
// Event bus (server/index.ts wires this to the WebSocket broadcast)
// ---------------------------------------------------------------------------

export type CronjobEvent =
  | { type: "cronjob_added"; cronjob: Cronjob }
  | { type: "cronjob_updated"; cronjob: Cronjob }
  | { type: "cronjob_deleted"; id: string }
  | { type: "cronjobs_prompt_updated"; value: string | null }
  | { type: "cronjob_run_updated"; run: CronjobRun }
  | { type: "log_entry"; entry: LogEntry }
  | { type: "clear_logs"; agentId: string };

let eventHandler: (e: CronjobEvent) => void = () => {};

export function onCronjobEvent(handler: (e: CronjobEvent) => void) {
  eventHandler = handler;
}

// ---------------------------------------------------------------------------
// CRUD
// ---------------------------------------------------------------------------

export function listCronjobs(): Cronjob[] {
  return cronjobs;
}

export function getCronjobsPrompt(): string | null {
  return cronjobsPrompt;
}

export function setCronjobsPrompt(value: string | null) {
  const normalized = value && value.trim() ? value.trim() : null;
  cronjobsPrompt = normalized;
  saveCronjobsPrompt(normalized);
  eventHandler({ type: "cronjobs_prompt_updated", value: normalized });
}

export type { AddCronjobInput };

export function addCronjob(input: AddCronjobInput): Cronjob {
  const cronjob = addCronjobDefinition(cronjobs, input);
  eventHandler({ type: "cronjob_added", cronjob });
  return cronjob;
}

export function updateCronjob(id: string, changes: UpdateCronjobChanges): Cronjob | null {
  const next = updateCronjobDefinition(cronjobs, id, changes);
  if (!next) return null;
  eventHandler({ type: "cronjob_updated", cronjob: next });
  return next;
}

export function deleteCronjob(id: string): boolean {
  if (!deleteCronjobDefinition(cronjobs, id)) return false;
  eventHandler({ type: "cronjob_deleted", id });
  return true;
}

export function getRunsForCronjob(jobId: string): CronjobRun[] {
  return loadRuns(jobId);
}

// Returns one entry per cronjob id that has a runs.json on disk — including
// jobs whose configs have since been deleted. The Runs tab uses this so
// historical runs from deleted cronjobs remain visible.
export function getAllRunsByJob(): { jobId: string; runs: CronjobRun[] }[] {
  return listAllCronjobIdsOnDisk().map((jobId) => ({ jobId, runs: loadRuns(jobId) }));
}

export function getRunTranscript(jobId: string, runId: string): { run: CronjobRun | null; entries: LogEntry[] } {
  const run = findRun(jobId, runId);
  if (!run) return { run: null, entries: [] };
  // Walk back from the leaf of the fork chain so edit-to-fork transcripts
  // render correctly. Old runs without currentSessionId fall back to the
  // root — equivalent to the un-forked case.
  const leaf = run.currentSessionId ?? run.rootSessionId;
  const entries = loadRunLogWithAncestors(jobId, runId, leaf);
  return { run, entries };
}

// ---------------------------------------------------------------------------
// System prompt for cronjobs
// ---------------------------------------------------------------------------

export function buildCronjobSystemPrompt(cronjob: Cronjob, jobId: string, runId: string, memoryPrompt?: string | null): string {
  return buildCronjobSystemPromptWithInstructions(cronjob, jobId, runId, cronjobsPrompt, memoryPrompt);
}

// ---------------------------------------------------------------------------
// Run lifecycle
// ---------------------------------------------------------------------------

export function emitRunReadFile(jobId: string, runId: string, rawPath: string): RunAffordanceResult {
  return emitRunReadFileWithDeps(activeRuns, writeAffordanceLog, jobId, runId, rawPath);
}

export function emitRunDiff(jobId: string, runId: string, dir?: string, commit?: string): RunAffordanceResult {
  return emitRunDiffWithDeps(activeRuns, writeAffordanceLog, jobId, runId, dir, commit);
}

function lifecycleDeps(): RunLifecycleDeps {
  return {
    activeRuns,
    emitEvent: (e) => eventHandler(e),
    hardTimeoutMs: HARD_TIMEOUT_MS,
  };
}

function writeAffordanceLog(
  active: AffordanceActiveRun,
  kind: LogEntry["kind"],
  content: string,
  metadata?: Record<string, unknown>,
  attachments?: Attachment[],
  extra?: Partial<Pick<LogEntry, "diff" | "file" | "terminal">>,
) {
  writeAffordanceLogWithDeps(lifecycleDeps(), active, kind, content, metadata, attachments, extra);
}

async function runConsumer(active: ActiveRun) {
  await runConsumerWithDeps(lifecycleDeps(), active);
}

function finalizeRun(active: ActiveRun, status: CronjobRun["status"], errorReason: string | null = null) {
  finalizeRunWithDeps(lifecycleDeps(), active, status, errorReason);
}

function fire(job: Cronjob, trigger: CronjobRun["trigger"], triggeredBy?: string): CronjobRun | null {
  const jobId = job.id;

  // Validate cwd before spawning so a moved directory surfaces as a failed
  // run rather than an opaque SDK exit.
  let cwdValid = true;
  let cwdError: string | null = null;
  let env: { [key: string]: string | undefined } | undefined;
  try {
    validateCwd(job.cwd);
    env = buildCronjobEnv(job.userId);
  } catch (err: any) {
    cwdValid = false;
    cwdError = err.message || "Invalid cronjob environment";
  }

  const runId = generateCronjobRunId();
  const placeholderSessionId = `pending-${runId}`;
  const now = Date.now();
  const run: CronjobRun = {
    id: runId,
    cronjobId: jobId,
    cronjobName: job.name,
    trigger,
    status: cwdValid ? "running" : "failed",
    startedAt: now,
    endedAt: cwdValid ? null : now,
    errorReason: cwdError,
    promptSnapshot: job.prompt,
    agentTypeSnapshot: job.agentType,
    modelFamilySnapshot: job.modelFamily,
    effortSnapshot: job.effort,
    cwdSnapshot: job.cwd,
    permissionModeSnapshot: job.permissionMode,
    ...(job.codexSandbox ? { codexSandboxSnapshot: job.codexSandbox } : {}),
    rootSessionId: placeholderSessionId,
    currentSessionId: placeholderSessionId,
    previewText: cwdError ?? "",
    ...(triggeredBy ? { triggeredBy } : {}),
  };
  appendRun(jobId, run);
  eventHandler({ type: "cronjob_run_updated", run });

  if (!cwdValid) {
    // Update next fire for scheduled trigger so we don't loop.
    if (trigger === "scheduled") {
      job.lastFireAt = now;
      job.nextFireAt = computeNextFire(job.schedule, now, now);
      saveCronjobs(cronjobs);
      eventHandler({ type: "cronjob_updated", cronjob: job });
    }
    return run;
  }

  const runToken = mintRunToken(jobId, runId, job.userId ?? null);
  const opts = buildRunSessionOptions(job, jobId, runId, withRunTokenEnv(env, runToken));
  let session: BackendSession;
  try {
    session = cronjobBackend(job).createSession(opts);
  } catch (err: any) {
    revokeRunToken(runId);
    const updated = updateRun(jobId, runId, {
      status: "failed",
      endedAt: Date.now(),
      errorReason: `Failed to create session: ${err.message || String(err)}`,
    });
    if (updated) eventHandler({ type: "cronjob_run_updated", run: updated });
    return updated ?? run;
  }

  const streamId = cronjobRunStreamId(runId);
  const active: ActiveRun = {
    jobId,
    runId,
    streamId,
    session,
    sessionId: null,
    rootSessionId: placeholderSessionId,
    consumerPromise: Promise.resolve(),
    hardTimeoutTimer: null,
    lastWrittenEntryId: null,
    lastAssistantText: "",
    trigger,
    killed: false,
    pendingEntries: [],
    isResume: false,
  };
  activeRuns.set(runId, active);
  active.consumerPromise = runConsumer(active);
  startRunHardTimeout(lifecycleDeps(), active);

  // Send the prompt as the first user message. Wrap in a try so ergonomic
  // errors don't crash the tick.
  (async () => {
    try {
      await session.send(job.prompt);
    } catch (err: any) {
      if (active.killed) return;
      console.error(`Cronjob run ${runId} input error:`, err.message);
      writeLog(active, "error", `Failed to send prompt: ${err.message || String(err)}`, eventHandler);
      try {
        session.close();
      } catch {}
      finalizeRun(active, "failed", err.message || String(err));
    }
  })();

  return run;
}

function buildRunSessionOptions(job: Cronjob, jobId: string, runId: string, env: { [key: string]: string | undefined } | undefined): CreateSessionOptions {
  return buildRunSessionOptionsWithDeps({ job, jobId, runId, env, buildSystemPrompt: buildCronjobSystemPrompt });
}

function recordSkippedRun(job: Cronjob): CronjobRun {
  const runId = generateCronjobRunId();
  const now = Date.now();
  // Skipped runs never open a session, so there's deliberately no
  // <runId>/<sessionId>.jsonl on disk. The "skipped-<runId>" placeholder
  // satisfies the type; CronjobRunView shows "This run was skipped" without
  // attempting to render a transcript (loadRunLog returns [] for missing
  // files, which is handled by the empty-state branch).
  const run: CronjobRun = {
    id: runId,
    cronjobId: job.id,
    cronjobName: job.name,
    trigger: "scheduled",
    status: "skipped",
    startedAt: now,
    endedAt: now,
    errorReason: "previous scheduled run still in flight",
    promptSnapshot: job.prompt,
    agentTypeSnapshot: job.agentType,
    modelFamilySnapshot: job.modelFamily,
    effortSnapshot: job.effort,
    cwdSnapshot: job.cwd,
    permissionModeSnapshot: job.permissionMode,
    ...(job.codexSandbox ? { codexSandboxSnapshot: job.codexSandbox } : {}),
    rootSessionId: `skipped-${runId}`,
    previewText: "",
  };
  appendRun(job.id, run);
  eventHandler({ type: "cronjob_run_updated", run });
  return run;
}

// ---------------------------------------------------------------------------
// Scheduler tick
// ---------------------------------------------------------------------------

function hasInFlightScheduledRun(jobId: string): boolean {
  for (const a of activeRuns.values()) {
    if (a.jobId === jobId && a.trigger === "scheduled") return true;
  }
  return false;
}

function tick() {
  const now = Date.now();
  for (const job of cronjobs) {
    if (!job.enabled) continue;
    if (now < job.nextFireAt) continue;
    if (hasInFlightScheduledRun(job.id)) {
      recordSkippedRun(job);
      job.nextFireAt = computeNextFire(job.schedule, job.lastFireAt ?? job.createdAt, now);
      saveCronjobs(cronjobs);
      eventHandler({ type: "cronjob_updated", cronjob: job });
      continue;
    }
    job.lastFireAt = now;
    job.nextFireAt = computeNextFire(job.schedule, job.lastFireAt, now);
    saveCronjobs(cronjobs);
    eventHandler({ type: "cronjob_updated", cronjob: job });
    fire(job, "scheduled");
  }
}

// ---------------------------------------------------------------------------
// Manual trigger
// ---------------------------------------------------------------------------

export function runCronjobNow(id: string, username: string, device?: string): CronjobRun | null {
  const job = cronjobs.find((c) => c.id === id);
  if (!job) return null;
  const triggeredBy = device && device !== username ? `${username} (${device})` : username;
  return fire(job, "manual", triggeredBy);
}

// ---------------------------------------------------------------------------
// Resume / edit-to-fork — follow-up turns into a finalized run
// ---------------------------------------------------------------------------

// Append a one-off log entry without an active session. Used to surface
// pre-flight errors (cwd invalid, leaf is a placeholder, etc.) so the user
// sees them in the run transcript instead of the message vanishing.
function emitRunErrorEntry(jobId: string, runId: string, message: string) {
  const run = findRun(jobId, runId);
  if (!run) return;
  const sessionId = run.currentSessionId ?? run.rootSessionId;
  const entry: LogEntry = {
    id: `log-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    agentId: cronjobRunStreamId(runId),
    timestamp: Date.now(),
    kind: "error",
    content: message,
  };
  appendRunLog(jobId, runId, sessionId, entry);
  eventHandler({ type: "log_entry", entry });
}

function buildRunResumeOptions(run: CronjobRun, resumeSessionId: string): CreateSessionOptions {
  const job = cronjobs.find((c) => c.id === run.cronjobId);
  const runToken = mintRunToken(run.cronjobId, run.id, job?.userId ?? null);
  return buildRunResumeOptionsWithDeps({
    run,
    resumeSessionId,
    cronjobs,
    runToken,
    buildSystemPrompt: buildCronjobSystemPrompt,
  });
}

// Wire up an ActiveRun around a backend session (resumed or freshly forked).
// Marks the run row "running", starts the consumer + hard timeout, and
// returns the active so callers can persist log entries / call session.send.
function installResumedActive(run: CronjobRun, session: BackendSession, sessionId: string): ActiveRun {
  const streamId = cronjobRunStreamId(run.id);
  const active: ActiveRun = {
    jobId: run.cronjobId,
    runId: run.id,
    streamId,
    session,
    sessionId,
    rootSessionId: run.rootSessionId,
    consumerPromise: Promise.resolve(),
    hardTimeoutTimer: null,
    lastWrittenEntryId: null,
    lastAssistantText: "",
    // Force trigger="manual" for resumed turns regardless of the run row's
    // original trigger. hasInFlightScheduledRun uses active.trigger to gate
    // the cron scheduler — if a user resumes a scheduled run, we don't want
    // the scheduler to suppress the cronjob's next regular fire while the
    // user-driven follow-up is in flight. (run.trigger on disk is unchanged
    // — that's history, not in-flight semantics.)
    trigger: "manual",
    killed: false,
    pendingEntries: [],
    isResume: true,
  };
  activeRuns.set(run.id, active);
  // Reset terminal state — the run row goes back to "running" until finalize.
  const updated = updateRun(run.cronjobId, run.id, { status: "running", endedAt: null, errorReason: null });
  if (updated) eventHandler({ type: "cronjob_run_updated", run: updated });
  active.consumerPromise = runConsumer(active);
  startRunHardTimeout(lifecycleDeps(), active);
  return active;
}

// Send a follow-up message into a finalized run by resuming the leaf session.
// No-op if the run is missing, currently in flight, or has no real SDK
// session to resume (skipped or pre-init failed).
export async function sendRunMessage(jobId: string, runId: string, text: string, username?: string): Promise<void> {
  const run = findRun(jobId, runId);
  if (!run) return;
  // Synchronous claim — must happen before any await so a concurrent
  // send/edit for the same runId bails immediately. installResumedActive's
  // activeRuns.set keeps the slot held; the `finally` below releases it.
  if (activeRuns.has(runId) || startingRuns.has(runId)) return;
  if (run.status === "skipped") {
    emitRunErrorEntry(jobId, runId, "Cannot resume a skipped run — it never opened a session.");
    return;
  }
  const leaf = run.currentSessionId ?? run.rootSessionId;
  if (leaf.startsWith("pending-") || leaf.startsWith("skipped-")) {
    emitRunErrorEntry(jobId, runId, "Cannot resume: the original run never reached backend init.");
    return;
  }
  try {
    validateCwd(run.cwdSnapshot);
  } catch (err: any) {
    emitRunErrorEntry(jobId, runId, `Cannot resume: cwd is invalid: ${err.message || String(err)}`);
    return;
  }
  if (!checkCronRunSessionFile(run, leaf, "resume")) return;

  startingRuns.add(runId);
  try {
    let session: BackendSession;
    try {
      session = cronRunBackend(run).resumeSession(leaf, buildRunResumeOptions(run, leaf));
    } catch (err: any) {
      revokeRunToken(runId);
      emitRunErrorEntry(jobId, runId, `Failed to resume: ${err.message || String(err)}`);
      return;
    }

    const active = installResumedActive(run, session, leaf);
    // Persist the user message so it shows up in the transcript.
    writeLog(active, "user_message", text, eventHandler, username ? { username } : undefined);

    const prefixedText = username ? `[${username}] ${text}` : text;
    (async () => {
      try {
        await session.send(prefixedText);
      } catch (err: any) {
        if (active.killed) return;
        console.error(`Cronjob run ${runId} send error:`, err.message);
        writeLog(active, "error", `Failed to send: ${err.message || String(err)}`, eventHandler);
        try {
          session.close();
        } catch {}
        finalizeRun(active, "failed", err.message || String(err));
      }
    })();
  } finally {
    startingRuns.delete(runId);
  }
}

// Edit-to-fork a user message in a finalized run. Mirrors agent-manager's
// editMessage: forks the backend session before the target message, persists
// fork lineage in the run's sessions.json, then resumes
// the new leaf and sends the edited text.
export async function editRunMessage(jobId: string, runId: string, logEntryId: string, newText: string, username?: string): Promise<void> {
  const run = findRun(jobId, runId);
  if (!run) return;
  // Synchronous claim — see sendRunMessage. Without this, getSessionMessages
  // and forkSession below would race against a second concurrent submission.
  if (activeRuns.has(runId) || startingRuns.has(runId)) return;
  if (run.status === "skipped") {
    emitRunErrorEntry(jobId, runId, "Cannot edit a skipped run — it never opened a session.");
    return;
  }
  const leaf = run.currentSessionId ?? run.rootSessionId;
  if (leaf.startsWith("pending-") || leaf.startsWith("skipped-")) {
    emitRunErrorEntry(jobId, runId, "Cannot edit: the original run never reached backend init.");
    return;
  }
  try {
    validateCwd(run.cwdSnapshot);
  } catch (err: any) {
    emitRunErrorEntry(jobId, runId, `Cannot edit: cwd is invalid: ${err.message || String(err)}`);
    return;
  }
  if (!checkCronRunSessionFile(run, leaf, "edit")) return;

  startingRuns.add(runId);
  try {
    await editRunMessageImpl(run, logEntryId, newText, leaf, username);
  } finally {
    startingRuns.delete(runId);
  }
}

async function editRunMessageImpl(run: CronjobRun, logEntryId: string, newText: string, leaf: string, username?: string): Promise<void> {
  await editRunMessageWithDeps(
    {
      cronRunBackend,
      buildRunResumeOptions,
      emitRunErrorEntry,
      installResumedActive,
      finalizeRun,
      revokeRunToken,
      emitEvent: eventHandler,
    },
    run,
    logEntryId,
    newText,
    leaf,
    username,
  );
}

// ---------------------------------------------------------------------------
// Startup reconciliation + scheduler boot
// ---------------------------------------------------------------------------

export function startCronjobScheduler() {
  // Load configs and cronjobsPrompt.
  cronjobs = loadCronjobs();
  cronjobsPrompt = loadCronjobsPrompt();

  // Recompute nextFireAt for every cronjob from current time forward.
  const now = Date.now();
  let dirty = false;
  for (const job of cronjobs) {
    if (!job.userId && job.username) {
      const owner = getUserByName(job.username);
      if (owner) {
        job.userId = owner.id;
        dirty = true;
      }
    }
    const schedule = clampSchedule(job.schedule);
    const anchor = job.lastFireAt ?? job.createdAt;
    const next = computeNextFire(schedule, anchor, now);
    if (next !== job.nextFireAt) {
      job.nextFireAt = next;
      dirty = true;
    }
  }
  if (dirty) saveCronjobs(cronjobs);

  // Mark any "running" rows on disk as failed — server crashed mid-run.
  for (const jobId of listAllCronjobIdsOnDisk()) {
    const runs = loadRuns(jobId);
    let mutated = false;
    for (const r of runs) {
      if (r.status === "running") {
        r.status = "failed";
        r.endedAt = now;
        r.errorReason = "server restarted during run";
        mutated = true;
      }
    }
    if (mutated) saveRuns(jobId, runs);
  }

  setTimeout(() => tick(), 5_000); // initial tick after small delay
  setInterval(() => tick(), TICK_INTERVAL_MS);
}

// ---------------------------------------------------------------------------
// Per-cronjob lifetime usage helpers (used by /usage)
// ---------------------------------------------------------------------------

export function readCronjobLifetimeUsage(jobId: string): {
  totalIn: number;
  cacheRead: number;
  cacheCreation: number;
  totalOut: number;
  costUSD: number;
} {
  return readCronjobLifetimeUsageFromDisk(jobId);
}
