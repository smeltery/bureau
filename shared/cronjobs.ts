import type { AgentBackendType } from "./agent-types.ts";
import type { CodexSandboxMode, EffortLevel } from "./agent-models.ts";

export type Schedule =
  | { type: "manual" }
  | { type: "daily"; hour: number; minute: number }
  | { type: "weekly"; weekday: 0 | 1 | 2 | 3 | 4 | 5 | 6; hour: number; minute: number }
  | { type: "interval"; minutes: number };

// Permission modes available for cronjobs. Modes that can block on human
// approval would hang forever in an unattended run.
export type CronjobPermissionMode = "bypassPermissions" | "never";

export interface Cronjob {
  id: string; // 8-char hex
  name: string; // free text, not unique
  schedule: Schedule;
  prompt: string; // first user message at each fire
  cwd: string;
  agentType: AgentBackendType;
  modelFamily: string;
  effort: EffortLevel;
  permissionMode: CronjobPermissionMode;
  codexSandbox?: CodexSandboxMode;
  enabled: boolean;
  createdBy: string;
  userId: string | null;
  username: string | null;
  device: string | null;
  createdAt: number;
  lastFireAt: number | null;
  nextFireAt: number | null;
}

export type CronjobRunStatus = "running" | "completed" | "failed" | "timed_out" | "skipped";
export type CronjobRunTrigger = "scheduled" | "manual";

export interface CronjobRun {
  id: string; // 8-char hex
  cronjobId: string;
  cronjobName: string; // denormalized so deleted-cronjob runs still display
  trigger: CronjobRunTrigger;
  status: CronjobRunStatus;
  startedAt: number;
  endedAt: number | null;
  errorReason: string | null;
  promptSnapshot: string;
  agentTypeSnapshot: AgentBackendType;
  modelFamilySnapshot: string;
  effortSnapshot: EffortLevel;
  cwdSnapshot: string;
  permissionModeSnapshot: CronjobPermissionMode;
  codexSandboxSnapshot?: CodexSandboxMode;
  rootSessionId: string; // first session id created at fire time
  // Leaf of the fork chain — equals rootSessionId for un-forked runs. Tracked
  // separately from rootSessionId so loadRunLogWithAncestors can walk back from
  // the leaf when the user has edited a message and forked. Optional for
  // backwards compatibility with runs persisted before resume support landed.
  currentSessionId?: string;
  previewText: string; // last assistant text block, truncated ~120 chars
  triggeredBy?: string; // manual runs only
}

// Cronjob runs piggy-back on the LogEntry.agentId routing by using a
// "cronrun-<runId>" prefix as a synthetic stream id. Entries written for a run
// carry this in `agentId` so the existing client-side Map<streamId, entries>
// routing works unchanged.
export function cronjobRunStreamId(runId: string): string {
  return `cronrun-${runId}`;
}

export function parseStreamId(id: string): { kind: "agent"; agentId: string } | { kind: "cronjob_run"; runId: string } {
  if (id.startsWith("cronrun-")) return { kind: "cronjob_run", runId: id.slice("cronrun-".length) };
  return { kind: "agent", agentId: id };
}

export function humanizeSchedule(s: Schedule): string {
  if (s.type === "manual") return "On demand";
  const pad = (n: number) => n.toString().padStart(2, "0");
  if (s.type === "daily") return `Daily at ${pad(s.hour)}:${pad(s.minute)}`;
  if (s.type === "weekly") {
    const weekdays = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    return `Weekly ${weekdays[s.weekday]} at ${pad(s.hour)}:${pad(s.minute)}`;
  }
  if (s.minutes < 60) return `Every ${s.minutes}m`;
  if (s.minutes % 60 === 0) return `Every ${s.minutes / 60}h`;
  return `Every ${Math.floor(s.minutes / 60)}h${s.minutes % 60}m`;
}
