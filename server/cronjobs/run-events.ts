import type { Attachment, CronjobRun, LogEntry } from "../../shared/types.ts";
import type { BackendSession, NormalizedEvent } from "../backends/types.ts";
import { accumulateRunSessionUsage, appendRunLog, appendRunSessionUsageSnapshot, updateRun } from "../persistence.ts";
import type { CronjobEvent } from "./index.ts";

export interface ActiveRun {
  jobId: string;
  runId: string;
  streamId: string;
  session: BackendSession;
  sessionId: string | null;
  rootSessionId: string;
  consumerPromise: Promise<void>;
  hardTimeoutTimer: ReturnType<typeof setTimeout> | null;
  lastWrittenEntryId: string | null;
  lastAssistantText: string;
  trigger: CronjobRun["trigger"];
  killed: boolean;
  pendingEntries: LogEntry[];
  isResume: boolean;
}

export function processNormalizedEvent(active: ActiveRun, ev: NormalizedEvent, emitEvent: (e: CronjobEvent) => void) {
  switch (ev.kind) {
    case "system_init": {
      const sessionId = ev.sessionId;
      if (sessionId && !active.sessionId) {
        active.sessionId = sessionId;
        if (sessionId !== active.rootSessionId) {
          const patch: Partial<CronjobRun> = active.isResume ? { currentSessionId: sessionId } : { rootSessionId: sessionId, currentSessionId: sessionId };
          const updated = updateRun(active.jobId, active.runId, patch);
          if (updated) {
            if (!active.isResume) active.rootSessionId = sessionId;
            emitEvent({ type: "cronjob_run_updated", run: updated });
          }
        }
        for (const entry of active.pendingEntries) {
          appendRunLog(active.jobId, active.runId, sessionId, entry);
          active.lastWrittenEntryId = entry.id;
        }
        active.pendingEntries = [];
      }
      break;
    }
    case "assistant_text":
      active.lastAssistantText = ev.text;
      writeLog(active, "text", ev.text, emitEvent);
      break;
    case "system_text":
      writeLog(active, "system", ev.text, emitEvent);
      break;
    case "task_lifecycle":
      writeLog(active, "system", ev.label, emitEvent, { taskEvent: { phase: ev.phase, taskId: ev.taskId } });
      break;
    case "thinking":
      writeLog(active, "thinking", ev.text, emitEvent, ev.durationMs != null ? { duration_ms: ev.durationMs } : undefined);
      break;
    case "tool_call":
      // metadata.subagent marks a call the run's SUBAGENT made rather than the
      // run itself. Absent for its own calls, for Codex, and for every entry
      // written before this field existed.
      writeLog(active, "tool_call", ev.name, emitEvent, { toolId: ev.toolUseId, input: ev.input, ...(ev.subagent ? { subagent: ev.subagent } : {}) });
      break;
    case "tool_result":
      writeLog(
        active,
        "tool_result",
        ev.content.slice(0, 10000),
        emitEvent,
        {
          toolUseId: ev.toolUseId,
          ...(ev.durationMs != null ? { duration_ms: ev.durationMs } : {}),
          ...(ev.isError != null ? { isError: ev.isError } : {}),
          ...(ev.subagent ? { subagent: ev.subagent } : {}),
        },
        ev.attachments,
      );
      break;
    case "file_view":
      writeLog(active, "file-view", ev.title, emitEvent, undefined, ev.attachments);
      break;
    case "turn_completed": {
      if (active.sessionId && ev.usage) {
        const cumulative = accumulateRunSessionUsage(active.jobId, active.runId, active.sessionId, ev.usage, ev.cost ?? 0);
        if (active.lastWrittenEntryId) {
          appendRunSessionUsageSnapshot(active.jobId, active.runId, active.sessionId, active.lastWrittenEntryId, cumulative);
        }
      }
      if (ev.status !== "completed") {
        const errorText = ev.error ?? `Run stopped: ${ev.status}.`;
        writeLog(active, "error", errorText, emitEvent);
      }
      break;
    }
    case "usage_update": {
      if (active.sessionId) {
        const cumulative = accumulateRunSessionUsage(active.jobId, active.runId, active.sessionId, ev.tokenUsage, 0);
        if (active.lastWrittenEntryId) {
          appendRunSessionUsageSnapshot(active.jobId, active.runId, active.sessionId, active.lastWrittenEntryId, cumulative);
        }
      }
      break;
    }
    case "compacted":
      writeLog(active, "system", ev.summary ? `Context compacted: ${ev.summary}` : "Context compacted.", emitEvent);
      break;
    case "approval_request":
      writeLog(active, "system", `Approval requested for ${ev.toolName}; cron jobs run unattended, so this run may wait until the hard timeout.`, emitEvent);
      break;
    case "error":
      writeLog(active, "error", ev.message, emitEvent);
      break;
  }
}

export function writeLog(
  active: ActiveRun,
  kind: LogEntry["kind"],
  content: string,
  emitEvent: (e: CronjobEvent) => void,
  metadata?: Record<string, unknown>,
  attachments?: Attachment[],
  extra?: Partial<Pick<LogEntry, "diff" | "file" | "terminal">>,
) {
  const entry: LogEntry = {
    id: `log-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    agentId: active.streamId,
    timestamp: Date.now(),
    kind,
    content,
    ...(metadata ? { metadata } : {}),
    ...(attachments && attachments.length > 0 ? { attachments } : {}),
    ...(extra ?? {}),
  };
  if (active.sessionId) {
    appendRunLog(active.jobId, active.runId, active.sessionId, entry);
    active.lastWrittenEntryId = entry.id;
  } else {
    active.pendingEntries.push(entry);
  }
  emitEvent({ type: "log_entry", entry });
}
