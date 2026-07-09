import type { Attachment, CronjobRun, LogEntry } from "../../shared/types.ts";
import { appendRunLog, updateRun } from "../persistence.ts";
import type { CronjobEvent } from "./index.ts";
import type { AffordanceActiveRun } from "./run-affordances.ts";
import { processNormalizedEvent, writeLog, type ActiveRun } from "./run-events.ts";
import { revokeRunToken } from "./tokens.ts";

export interface RunLifecycleDeps {
  activeRuns: Map<string, ActiveRun>;
  emitEvent: (e: CronjobEvent) => void;
  hardTimeoutMs: number;
}

export function writeAffordanceLogWithDeps(
  deps: RunLifecycleDeps,
  active: AffordanceActiveRun,
  kind: LogEntry["kind"],
  content: string,
  metadata?: Record<string, unknown>,
  attachments?: Attachment[],
  extra?: Partial<Pick<LogEntry, "diff" | "file" | "terminal">>,
) {
  const fullActive = deps.activeRuns.get(active.runId);
  if (!fullActive) return;
  writeLog(fullActive, kind, content, deps.emitEvent, metadata, attachments, extra);
}

export async function runConsumerWithDeps(deps: RunLifecycleDeps, active: ActiveRun) {
  try {
    for await (const ev of active.session.stream()) {
      processNormalizedEvent(active, ev, deps.emitEvent);
      if (ev.kind === "turn_completed") {
        const status: CronjobRun["status"] = ev.status === "completed" ? "completed" : "failed";
        const errorReason = ev.status === "completed" ? null : (ev.error ?? `Run stopped: ${ev.status}`);
        finalizeRunWithDeps(deps, active, status, errorReason);
        return;
      }
      if (ev.kind === "error") {
        finalizeRunWithDeps(deps, active, "failed", ev.message);
        return;
      }
    }
    if (deps.activeRuns.has(active.runId)) {
      finalizeRunWithDeps(deps, active, "failed", "stream ended before turn completed");
    }
  } catch (err: any) {
    if (active.killed) return; // hard timeout already handled
    console.error(`Cronjob run ${active.runId} stream error:`, err.message);
    writeLog(active, "error", `Stream error: ${err.message}`, deps.emitEvent);
    finalizeRunWithDeps(deps, active, "failed", `Stream error: ${err.message}`);
  }
}

export function finalizeRunWithDeps(deps: RunLifecycleDeps, active: ActiveRun, status: CronjobRun["status"], errorReason: string | null = null) {
  // Idempotent: multiple paths can race to finalize. The first one wins;
  // later calls no-op so a late stream close cannot clobber the real result.
  if (!deps.activeRuns.has(active.runId)) return;
  deps.activeRuns.delete(active.runId);
  if (active.hardTimeoutTimer) {
    clearTimeout(active.hardTimeoutTimer);
    active.hardTimeoutTimer = null;
  }
  // If init never arrived, the run row's rootSessionId is still the
  // `pending-<runId>` placeholder. Flush buffered pre-init entries there so
  // loadRunLogWithAncestors can find them after reload.
  if (!active.sessionId && active.pendingEntries.length > 0) {
    for (const entry of active.pendingEntries) {
      appendRunLog(active.jobId, active.runId, active.rootSessionId, entry);
    }
    active.pendingEntries = [];
  }
  // Release the backend subprocess. Streams are persistent across turns.
  try {
    active.session.close();
  } catch {}
  revokeRunToken(active.runId);
  const previewText = (active.lastAssistantText || "").trim().replace(/\s+/g, " ").slice(0, 120);
  const updated = updateRun(active.jobId, active.runId, {
    status,
    endedAt: Date.now(),
    errorReason: errorReason ?? null,
    previewText,
  });
  if (updated) deps.emitEvent({ type: "cronjob_run_updated", run: updated });
}

export function startRunHardTimeout(deps: RunLifecycleDeps, active: ActiveRun) {
  active.hardTimeoutTimer = setTimeout(() => {
    if (!deps.activeRuns.has(active.runId)) return;
    active.killed = true;
    try {
      active.session.close();
    } catch {}
    writeLog(active, "error", "Cron job run exceeded 30-minute hard timeout.", deps.emitEvent);
    finalizeRunWithDeps(deps, active, "timed_out", "exceeded global run timeout");
  }, deps.hardTimeoutMs);
}
