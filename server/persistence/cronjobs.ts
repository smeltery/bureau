// Persistence layer for cronjobs and their runs. Mirrors the agent persistence
// shape (sessions.json + per-session JSONL) under one extra layer of nesting:
//
//   ~/.bureau/cronjobs/
//     cronjobs.json                    Cronjob[] config
//     cronjob-history.json             { id -> { lastName } } for deleted-cronjob name preservation
//     cronjobs-prompt.md               raw text; system prompt appended to every cronjob
//     <jobId>/
//       runs.json                      CronjobRun[] index
//       <runId>/
//         sessions.json                fork lineage + per-session usage (same shape as agent)
//         <sessionId>.jsonl            append-only log
import { join } from "path";
import { mkdirSync, readFileSync, existsSync, readdirSync } from "fs";
import type { AgentBackendType, CodexSandboxMode, Cronjob, CronjobRun, EffortLevel } from "../../shared/types.ts";
import { legacyScheduleRoom } from "../cronjobs/access.ts";
import { validateCodexSandbox, validateCronjobPermissionMode, validateEffort } from "../agent-validators.ts";
import { atomicWriteFileSync, CRONJOBS_DIR, CRONJOBS_FILE, CRONJOB_HISTORY_FILE, CRONJOBS_PROMPT_FILE } from "./paths.ts";

// Cronjobs system prompt — owned by the cronjob manager and stored in its own
// file, not folded into office-config.json. Two managers writing the same
// JSON with stale in-memory copies would silently clobber each other, so the
// cronjob prompt is deliberately kept in a separate file.
export function loadCronjobsPrompt(): string | null {
  try {
    if (!existsSync(CRONJOBS_PROMPT_FILE)) return null;
    const content = readFileSync(CRONJOBS_PROMPT_FILE, "utf-8");
    return content.trim() ? content : null;
  } catch {
    return null;
  }
}

export function saveCronjobsPrompt(value: string | null) {
  try {
    atomicWriteFileSync(CRONJOBS_PROMPT_FILE, value ?? "");
  } catch (err) {
    console.error("Failed to save cronjobs prompt:", err);
  }
}

// ---------------------------------------------------------------------------
// Cronjob configs
// ---------------------------------------------------------------------------

export function loadCronjobs(): Cronjob[] {
  try {
    if (!existsSync(CRONJOBS_FILE)) return [];
    const parsed = JSON.parse(readFileSync(CRONJOBS_FILE, "utf-8"));
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((c): c is Cronjob => c && typeof c === "object" && typeof c.id === "string")
      .map((c) => ({
        ...c,
        roomId: c.roomId === undefined ? legacyScheduleRoom(c.userId, c.username ?? c.createdBy) : c.roomId,
        agentType: normalizeCronjobAgentType((c as { agentType?: unknown }).agentType),
        permissionMode: validateCronjobPermissionMode(normalizeCronjobAgentType((c as { agentType?: unknown }).agentType), (c as { permissionMode?: string }).permissionMode),
        effort: validateEffort(
          normalizeCronjobAgentType((c as { agentType?: unknown }).agentType),
          normalizeCronjobModelFamily((c as { modelFamily?: unknown }).modelFamily),
          (c as { effort?: EffortLevel }).effort,
        ),
        codexSandbox: normalizeCronjobAgentType((c as { agentType?: unknown }).agentType) === "codex" ? validateCodexSandbox((c as { codexSandbox?: CodexSandboxMode }).codexSandbox) : undefined,
        userId: typeof (c as { userId?: unknown }).userId === "string" ? (c as { userId: string }).userId : null,
        username: normalizeCronjobUsername(c),
      }));
  } catch (err) {
    console.error("Failed to load cronjobs:", err);
    return [];
  }
}

function normalizeCronjobAgentType(value: unknown): AgentBackendType {
  if (value === "codex" || value === "opencode") return value;
  return "claude";
}

function normalizeCronjobModelFamily(value: unknown): string {
  return typeof value === "string" && value.length > 0 ? value : "opus";
}

function normalizeCronjobUsername(value: unknown): string | null {
  const record = value as { username?: unknown; createdBy?: unknown; device?: unknown };
  if (typeof record.username === "string") return record.username;
  if (typeof record.createdBy === "string") return record.createdBy;
  if (typeof record.device === "string") return record.device;
  return null;
}

export function saveCronjobs(cronjobs: Cronjob[]) {
  try {
    atomicWriteFileSync(CRONJOBS_FILE, JSON.stringify(cronjobs, null, 2));
  } catch (err) {
    console.error("Failed to save cronjobs:", err);
  }
}

export type CronjobHistory = Record<string, { lastName: string; roomId?: string | null; userId?: string | null }>;

export function loadCronjobHistory(): CronjobHistory {
  try {
    if (!existsSync(CRONJOB_HISTORY_FILE)) return {};
    return JSON.parse(readFileSync(CRONJOB_HISTORY_FILE, "utf-8")) as CronjobHistory;
  } catch {
    return {};
  }
}

export function saveCronjobHistory(history: CronjobHistory) {
  try {
    atomicWriteFileSync(CRONJOB_HISTORY_FILE, JSON.stringify(history, null, 2));
  } catch (err) {
    console.error("Failed to save cronjob history:", err);
  }
}

// ---------------------------------------------------------------------------
// Runs
// ---------------------------------------------------------------------------

function jobDir(jobId: string): string {
  return join(CRONJOBS_DIR, jobId);
}

function runsFile(jobId: string): string {
  return join(jobDir(jobId), "runs.json");
}

export function loadRuns(jobId: string): CronjobRun[] {
  try {
    const file = runsFile(jobId);
    if (!existsSync(file)) return [];
    const parsed = JSON.parse(readFileSync(file, "utf-8"));
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((r): r is CronjobRun => r && typeof r === "object" && typeof r.id === "string")
      .map((r) => ({
        ...r,
        agentTypeSnapshot: normalizeCronjobAgentType((r as { agentTypeSnapshot?: unknown }).agentTypeSnapshot),
        permissionModeSnapshot: validateCronjobPermissionMode(
          normalizeCronjobAgentType((r as { agentTypeSnapshot?: unknown }).agentTypeSnapshot),
          (r as { permissionModeSnapshot?: string }).permissionModeSnapshot,
        ),
        effortSnapshot: validateEffort(
          normalizeCronjobAgentType((r as { agentTypeSnapshot?: unknown }).agentTypeSnapshot),
          normalizeCronjobModelFamily((r as { modelFamilySnapshot?: unknown }).modelFamilySnapshot),
          (r as { effortSnapshot?: EffortLevel }).effortSnapshot,
        ),
        codexSandboxSnapshot:
          normalizeCronjobAgentType((r as { agentTypeSnapshot?: unknown }).agentTypeSnapshot) === "codex"
            ? validateCodexSandbox((r as { codexSandboxSnapshot?: CodexSandboxMode }).codexSandboxSnapshot)
            : undefined,
      }));
  } catch (err) {
    console.error(`Failed to load runs for ${jobId}:`, err);
    return [];
  }
}

export function saveRuns(jobId: string, runs: CronjobRun[]) {
  try {
    mkdirSync(jobDir(jobId), { recursive: true });
    atomicWriteFileSync(runsFile(jobId), JSON.stringify(runs, null, 2));
  } catch (err) {
    console.error(`Failed to save runs for ${jobId}:`, err);
  }
}

// Append a single run (writes the whole file — mirrors saveTasks pattern).
export function appendRun(jobId: string, run: CronjobRun) {
  const runs = loadRuns(jobId);
  runs.push(run);
  saveRuns(jobId, runs);
}

export function updateRun(jobId: string, runId: string, patch: Partial<CronjobRun>): CronjobRun | null {
  const runs = loadRuns(jobId);
  const idx = runs.findIndex((r) => r.id === runId);
  if (idx < 0) return null;
  runs[idx] = { ...runs[idx], ...patch };
  saveRuns(jobId, runs);
  return runs[idx];
}

export function findRun(jobId: string, runId: string): CronjobRun | null {
  return loadRuns(jobId).find((r) => r.id === runId) ?? null;
}

// List every cronjobId that has a directory on disk, even if its config is
// gone. Used by /usage and reconciliation. Filtered to 8-char hex (the
// generateHexId format) so stray dirs (editor swap files, future siblings
// like `tmp/`) aren't mistaken for cronjob ids.
const HEX8 = /^[a-f0-9]{8}$/;
export function listAllCronjobIdsOnDisk(): string[] {
  try {
    if (!existsSync(CRONJOBS_DIR)) return [];
    return readdirSync(CRONJOBS_DIR, { withFileTypes: true })
      .filter((d) => d.isDirectory() && HEX8.test(d.name))
      .map((d) => d.name);
  } catch {
    return [];
  }
}
