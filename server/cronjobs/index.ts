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

import { type Attachment, type Cronjob, type CronjobRun, type LogEntry } from "../../shared/types.ts";
import { loadCronjobs, saveCronjobs, loadCronjobsPrompt, loadRuns, saveRuns, appendRun, updateRun, findRun, appendRunLog, loadRunLogWithAncestors, listAllCronjobIdsOnDisk } from "../persistence.ts";
import { validateCwd } from "../agents/session/paths.ts";
import type { CreateSessionOptions } from "../backends/types.ts";
import { getUserByName } from "../users.ts";
import { computeNextFire } from "./schedule.ts";
import { mintRunToken, revokeRunToken } from "./tokens.ts";
import { buildCronjobMemoryPrompt, buildCronjobSystemPrompt as buildCronjobSystemPromptWithInstructions } from "./system-prompt.ts";
import { emitRunDiffWithDeps, emitRunReadFileWithDeps, type AffordanceActiveRun, type RunAffordanceResult } from "./run-affordances.ts";
import { readCronjobLifetimeUsage as readCronjobLifetimeUsageFromDisk } from "./usage.ts";
import { writeLog, type ActiveRun } from "./run-events.ts";
import { finalizeRunWithDeps, runConsumerWithDeps, startRunHardTimeout, writeAffordanceLogWithDeps, type RunLifecycleDeps } from "./run-lifecycle.ts";
import { startCronjobSchedulerWithDeps } from "./scheduler.ts";
import { buildCronjobEnv, buildRunSessionOptions as buildRunSessionOptionsWithDeps, cronjobBackend, withRunTokenEnv } from "./session-options.ts";
import { editRunMessageWithDeps, sendRunMessageWithDeps, type RunContinuationDeps } from "./run-continuation.ts";
import { fireCronjobRunWithDeps, recordSkippedRunWithDeps, type RunStartDeps } from "./run-start.ts";
import {
  addCronjob,
  deleteCronjob,
  emitCronjobEvent,
  findCronjob,
  getCronjobDefinitions,
  getCronjobsPrompt,
  listCronjobs,
  onCronjobEvent,
  setCronjobDefinitions,
  setCronjobsPrompt,
  setLoadedCronjobsPrompt,
  updateCronjob,
  type AddCronjobInput,
  type CronjobEvent,
} from "./cronjob-store.ts";
// Re-exported so external callers can use the same scheduler math (kept for
// the public surface of this module before the refactor split it out).
export { computeNextFire };
export { buildCronjobMemoryPrompt };
export { addCronjob, deleteCronjob, getCronjobsPrompt, listCronjobs, onCronjobEvent, setCronjobsPrompt, updateCronjob };
export type { CronjobEvent };

const activeRuns = new Map<string, ActiveRun>(); // runId -> ActiveRun

// Synchronously-claimed slot for runs whose resume/fork is mid-startup but
// hasn't reached `activeRuns.set` yet. Without this gate, a second concurrent
// send/edit call for the same runId would pass the activeRuns.has() check
// during the awaits in editRunMessage (getSessionMessages → forkSession),
// fork twice, and end up overwriting each other's ActiveRun entries.
const startingRuns = new Set<string>();

const HARD_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes
const TICK_INTERVAL_MS = 60 * 1000;

export type { AddCronjobInput };

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
  return buildCronjobSystemPromptWithInstructions(cronjob, jobId, runId, getCronjobsPrompt(), memoryPrompt);
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
    emitEvent: (e) => emitCronjobEvent(e),
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

function continuationDeps(): RunContinuationDeps {
  return {
    activeRuns,
    startingRuns,
    getCronjobs: getCronjobDefinitions,
    buildSystemPrompt: buildCronjobSystemPrompt,
    lifecycleDeps,
    runConsumer,
    finalizeRun,
    emitEvent: emitCronjobEvent,
  };
}

function runStartDeps(): RunStartDeps {
  return {
    activeRuns,
    appendRun,
    updateRun,
    saveCronjobs,
    getCronjobs: getCronjobDefinitions,
    emitEvent: emitCronjobEvent,
    validateCwd,
    buildEnv: buildCronjobEnv,
    mintRunToken,
    revokeRunToken,
    withRunTokenEnv,
    buildRunSessionOptions,
    createSession: (job, opts) => cronjobBackend(job).createSession(opts),
    runConsumer,
    startRunHardTimeout,
    lifecycleDeps,
    finalizeRun,
    computeNextFire,
  };
}

function fire(job: Cronjob, trigger: CronjobRun["trigger"], triggeredBy?: string): CronjobRun | null {
  return fireCronjobRunWithDeps(runStartDeps(), job, trigger, triggeredBy);
}

function buildRunSessionOptions(job: Cronjob, jobId: string, runId: string, env: { [key: string]: string | undefined } | undefined): CreateSessionOptions {
  return buildRunSessionOptionsWithDeps({ job, jobId, runId, env, buildSystemPrompt: buildCronjobSystemPrompt });
}

function recordSkippedRun(job: Cronjob): CronjobRun {
  return recordSkippedRunWithDeps({ appendRun, emitEvent: emitCronjobEvent }, job);
}

function hasInFlightScheduledRun(jobId: string): boolean {
  for (const a of activeRuns.values()) {
    if (a.jobId === jobId && a.trigger === "scheduled") return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Manual trigger
// ---------------------------------------------------------------------------

export function runCronjobNow(id: string, username: string, device?: string): CronjobRun | null {
  const job = findCronjob(id);
  if (!job) return null;
  const triggeredBy = device && device !== username ? `${username} (${device})` : username;
  return fire(job, "manual", triggeredBy);
}

// ---------------------------------------------------------------------------
// Resume / edit-to-fork — follow-up turns into a finalized run
// ---------------------------------------------------------------------------

// Send a follow-up message into a finalized run by resuming the leaf session.
// No-op if the run is missing, currently in flight, or has no real SDK
// session to resume (skipped or pre-init failed).
export async function sendRunMessage(jobId: string, runId: string, text: string, username?: string): Promise<void> {
  await sendRunMessageWithDeps(continuationDeps(), jobId, runId, text, username);
}

// Edit-to-fork a user message in a finalized run. Mirrors agent-manager's
// editMessage: forks the backend session before the target message, persists
// fork lineage in the run's sessions.json, then resumes
// the new leaf and sends the edited text.
export async function editRunMessage(jobId: string, runId: string, logEntryId: string, newText: string, username?: string): Promise<void> {
  await editRunMessageWithDeps(continuationDeps(), jobId, runId, logEntryId, newText, username);
}

// ---------------------------------------------------------------------------
// Startup reconciliation + scheduler boot
// ---------------------------------------------------------------------------

export function startCronjobScheduler() {
  startCronjobSchedulerWithDeps({
    getCronjobs: getCronjobDefinitions,
    setCronjobs: (next) => {
      setCronjobDefinitions(next);
    },
    loadCronjobs,
    saveCronjobs,
    loadCronjobsPrompt,
    setCronjobsPrompt: (next) => {
      setLoadedCronjobsPrompt(next);
    },
    listAllCronjobIdsOnDisk,
    loadRuns,
    saveRuns,
    getUserByName,
    hasInFlightScheduledRun,
    recordSkippedRun,
    fire,
    emitEvent: emitCronjobEvent,
    tickIntervalMs: TICK_INTERVAL_MS,
  });
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
