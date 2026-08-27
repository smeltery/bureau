import { validateCwd } from "../agents/session/paths.ts";
import type { BackendSession, CreateSessionOptions } from "../backends/types.ts";
import { appendRunLog, findRun, updateRun } from "../persistence.ts";
import { cronjobRunStreamId, type Cronjob, type CronjobRun, type LogEntry } from "../../shared/types.ts";
import { buildCronjobEnv, buildRunResumeOptions as buildRunResumeOptionsWithDeps, cronRunBackend } from "./session-options.ts";
import { mintRunToken, revokeRunToken } from "./tokens.ts";
import { editRunMessageWithDeps as editRunMessageCoreWithDeps } from "./run-edit.ts";
import { startRunHardTimeout, type RunLifecycleDeps } from "./run-lifecycle.ts";
import { writeLog, type ActiveRun } from "./run-events.ts";
import type { CronjobEvent } from "./index.ts";

export interface RunContinuationDeps {
  activeRuns: Map<string, ActiveRun>;
  startingRuns: Set<string>;
  getCronjobs(): Cronjob[];
  buildSystemPrompt(cronjob: Cronjob, jobId: string, runId: string, memoryPrompt?: string | null): string;
  lifecycleDeps(): RunLifecycleDeps;
  runConsumer(active: ActiveRun): Promise<void>;
  finalizeRun(active: ActiveRun, status: CronjobRun["status"], errorReason?: string | null): void;
  emitEvent(event: CronjobEvent): void;
}

export async function sendRunMessageWithDeps(deps: RunContinuationDeps, jobId: string, runId: string, text: string, username?: string): Promise<void> {
  const run = findRun(jobId, runId);
  if (!run) return;
  // Synchronous claim — must happen before any await so a concurrent
  // send/edit for the same runId bails immediately. installResumedActive's
  // activeRuns.set keeps the slot held; the `finally` below releases it.
  if (deps.activeRuns.has(runId) || deps.startingRuns.has(runId)) return;
  if (run.status === "skipped") {
    emitRunErrorEntry(deps, jobId, runId, "Cannot resume a skipped run — it never opened a session.");
    return;
  }
  const leaf = run.currentSessionId ?? run.rootSessionId;
  if (leaf.startsWith("pending-") || leaf.startsWith("skipped-")) {
    emitRunErrorEntry(deps, jobId, runId, "Cannot resume: the original run never reached backend init.");
    return;
  }
  try {
    validateCwd(run.cwdSnapshot);
  } catch (err: any) {
    emitRunErrorEntry(deps, jobId, runId, `Cannot resume: cwd is invalid: ${err.message || String(err)}`);
    return;
  }
  if (!checkCronRunSessionFile(deps, run, leaf, "resume")) return;

  deps.startingRuns.add(runId);
  try {
    let session: BackendSession;
    try {
      session = cronRunBackend(run).resumeSession(leaf, buildRunResumeOptions(deps, run, leaf));
    } catch (err: any) {
      revokeRunToken(runId);
      emitRunErrorEntry(deps, jobId, runId, `Failed to resume: ${err.message || String(err)}`);
      return;
    }

    const active = installResumedActive(deps, run, session, leaf);
    // Persist the user message so it shows up in the transcript.
    writeLog(active, "user_message", text, deps.emitEvent, username ? { username } : undefined);

    const prefixedText = username ? `[${username}] ${text}` : text;
    (async () => {
      try {
        await session.send(prefixedText);
      } catch (err: any) {
        if (active.killed) return;
        console.error(`Cronjob run ${runId} send error:`, err.message);
        writeLog(active, "error", `Failed to send: ${err.message || String(err)}`, deps.emitEvent);
        try {
          session.close();
        } catch {}
        deps.finalizeRun(active, "failed", err.message || String(err));
      }
    })();
  } finally {
    deps.startingRuns.delete(runId);
  }
}

export async function editRunMessageWithDeps(deps: RunContinuationDeps, jobId: string, runId: string, logEntryId: string, newText: string, username?: string): Promise<void> {
  const run = findRun(jobId, runId);
  if (!run) return;
  // Synchronous claim — see sendRunMessageWithDeps. Without this,
  // getSessionMessages and forkSession below would race against a second
  // concurrent submission.
  if (deps.activeRuns.has(runId) || deps.startingRuns.has(runId)) return;
  if (run.status === "skipped") {
    emitRunErrorEntry(deps, jobId, runId, "Cannot edit a skipped run — it never opened a session.");
    return;
  }
  const leaf = run.currentSessionId ?? run.rootSessionId;
  if (leaf.startsWith("pending-") || leaf.startsWith("skipped-")) {
    emitRunErrorEntry(deps, jobId, runId, "Cannot edit: the original run never reached backend init.");
    return;
  }
  try {
    validateCwd(run.cwdSnapshot);
  } catch (err: any) {
    emitRunErrorEntry(deps, jobId, runId, `Cannot edit: cwd is invalid: ${err.message || String(err)}`);
    return;
  }
  if (!checkCronRunSessionFile(deps, run, leaf, "edit")) return;

  deps.startingRuns.add(runId);
  try {
    await editRunMessageImpl(deps, run, logEntryId, newText, leaf, username);
  } finally {
    deps.startingRuns.delete(runId);
  }
}

function checkCronRunSessionFile(deps: RunContinuationDeps, run: CronjobRun, leaf: string, action: "resume" | "edit"): boolean {
  let env: { [key: string]: string | undefined } | undefined;
  try {
    const job = deps.getCronjobs().find((c) => c.id === run.cronjobId);
    env = buildCronjobEnv(job?.userId ?? null);
  } catch (err: any) {
    emitRunErrorEntry(deps, run.cronjobId, run.id, `Cannot ${action}: env file is invalid: ${err.message || String(err)}`);
    return false;
  }
  const error = cronRunBackend(run).checkSessionResumable(leaf, {
    cwd: run.cwdSnapshot,
    env,
  });
  if (!error) return true;
  emitRunErrorEntry(deps, run.cronjobId, run.id, action === "resume" ? error : `Cannot edit: ${error}`);
  return false;
}

// Append a one-off log entry without an active session. Used to surface
// pre-flight errors (cwd invalid, leaf is a placeholder, etc.) so the user
// sees them in the run transcript instead of the message vanishing.
function emitRunErrorEntry(deps: RunContinuationDeps, jobId: string, runId: string, message: string) {
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
  deps.emitEvent({ type: "log_entry", entry });
}

function buildRunResumeOptions(deps: RunContinuationDeps, run: CronjobRun, resumeSessionId: string): CreateSessionOptions {
  const job = deps.getCronjobs().find((c) => c.id === run.cronjobId);
  const runToken = mintRunToken(run.cronjobId, run.id, job?.userId ?? null);
  return buildRunResumeOptionsWithDeps({
    run,
    resumeSessionId,
    cronjobs: deps.getCronjobs(),
    runToken,
    buildSystemPrompt: deps.buildSystemPrompt,
  });
}

// Wire up an ActiveRun around a backend session (resumed or freshly forked).
// Marks the run row "running", starts the consumer + hard timeout, and
// returns the active so callers can persist log entries / call session.send.
function installResumedActive(deps: RunContinuationDeps, run: CronjobRun, session: BackendSession, sessionId: string): ActiveRun {
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
  deps.activeRuns.set(run.id, active);
  // Reset terminal state — the run row goes back to "running" until finalize.
  const updated = updateRun(run.cronjobId, run.id, { status: "running", endedAt: null, errorReason: null });
  if (updated) deps.emitEvent({ type: "cronjob_run_updated", run: updated });
  active.consumerPromise = deps.runConsumer(active);
  startRunHardTimeout(deps.lifecycleDeps(), active);
  return active;
}

async function editRunMessageImpl(deps: RunContinuationDeps, run: CronjobRun, logEntryId: string, newText: string, leaf: string, username?: string): Promise<void> {
  await editRunMessageCoreWithDeps(
    {
      cronRunBackend,
      buildRunResumeOptions: (targetRun, resumeSessionId) => buildRunResumeOptions(deps, targetRun, resumeSessionId),
      emitRunErrorEntry: (jobId, runId, message) => emitRunErrorEntry(deps, jobId, runId, message),
      installResumedActive: (targetRun, session, sessionId) => installResumedActive(deps, targetRun, session, sessionId),
      finalizeRun: deps.finalizeRun,
      revokeRunToken,
      emitEvent: deps.emitEvent,
    },
    run,
    logEntryId,
    newText,
    leaf,
    username,
  );
}
