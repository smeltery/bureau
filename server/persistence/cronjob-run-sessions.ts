// Persistence for cronjob run session metadata and JSONL logs.
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "fs";
import { join } from "path";
import type { LogEntry } from "../../shared/types.ts";
import { prepareLogEntry } from "./logs/log-redaction.ts";
import { atomicWriteFileSync, CRONJOBS_DIR } from "./paths.ts";
import type { PersistedUsage } from "./logs/sessions.ts";

function jobDir(jobId: string): string {
  return join(CRONJOBS_DIR, jobId);
}

function runDir(jobId: string, runId: string): string {
  return join(jobDir(jobId), runId);
}

function sessionsMapFile(jobId: string, runId: string): string {
  return join(runDir(jobId, runId), "sessions.json");
}

function sessionLogFile(jobId: string, runId: string, sessionId: string): string {
  return join(runDir(jobId, runId), `${sessionId}.jsonl`);
}

// ---------------------------------------------------------------------------
// Per-run sessions.json (same shape as agent sessions map)
// ---------------------------------------------------------------------------

type UsageSnapshot = { entryId: string; usage: PersistedUsage };
type RunSessionsMap = Record<
  string,
  {
    topic: string | null;
    lastModified: number;
    forkedFrom?: string;
    forkMessageId?: string;
    claudeConfigDir?: string;
    usage?: PersistedUsage;
    priorRunsUsage?: PersistedUsage;
    forkBaseUsage?: PersistedUsage;
    usageSnapshots?: UsageSnapshot[];
  }
>;

export function loadRunSessionsMap(jobId: string, runId: string): RunSessionsMap {
  try {
    const file = sessionsMapFile(jobId, runId);
    if (!existsSync(file)) return {};
    return JSON.parse(readFileSync(file, "utf-8")) as RunSessionsMap;
  } catch {
    return {};
  }
}

function saveRunSessionsMap(jobId: string, runId: string, map: RunSessionsMap) {
  try {
    mkdirSync(runDir(jobId, runId), { recursive: true });
    atomicWriteFileSync(sessionsMapFile(jobId, runId), JSON.stringify(map, null, 2));
  } catch (err) {
    console.error(`Failed to save run sessions map ${jobId}/${runId}:`, err);
  }
}

// Mirror of persistSessionFork (agent side) for cronjob runs. Records that
// `sessionId` was forked from `forkedFrom` at log entry `forkMessageId`, so
// loadRunLogWithAncestors can walk back through the chain when rendering.
export function persistRunSessionFork(jobId: string, runId: string, sessionId: string, forkedFrom: string, forkMessageId: string, claudeConfigDir?: string, forkBaseUsage?: PersistedUsage) {
  const map = loadRunSessionsMap(jobId, runId);
  const existing = map[sessionId] ?? { topic: null, lastModified: 0 };
  map[sessionId] = {
    ...existing,
    topic: existing.topic ?? null,
    lastModified: Date.now(),
    forkedFrom,
    forkMessageId,
    ...(claudeConfigDir ? { claudeConfigDir } : {}),
    ...(forkBaseUsage ? { forkBaseUsage } : {}),
  };
  saveRunSessionsMap(jobId, runId, map);
}

export function getRunSessionClaudeConfigDir(jobId: string, runId: string, sessionId: string): string | null {
  const map = loadRunSessionsMap(jobId, runId);
  return map[sessionId]?.claudeConfigDir ?? null;
}

export function ensureRunSessionClaudeConfigDir(jobId: string, runId: string, sessionId: string, fallbackDir: string): string {
  const map = loadRunSessionsMap(jobId, runId);
  const existing = map[sessionId];
  if (existing?.claudeConfigDir) return existing.claudeConfigDir;
  map[sessionId] = { ...(existing ?? { topic: null, lastModified: 0 }), claudeConfigDir: fallbackDir, lastModified: existing?.lastModified ?? Date.now() };
  saveRunSessionsMap(jobId, runId, map);
  return fallbackDir;
}

// Mirror of findUsageAtFork (agent side) for cronjob runs. Walks the parent's
// JSONL to locate `forkMessageId`, then returns the latest usage snapshot
// before that position. Falls back to current cumulative when no snapshot
// pre-dates the fork.
export function findUsageAtForkRun(jobId: string, runId: string, parentSessionId: string, forkMessageId: string): PersistedUsage | undefined {
  const entries = loadRunLog(jobId, runId, parentSessionId);
  const positions = new Map<string, number>();
  entries.forEach((e, i) => positions.set(e.id, i));
  const forkPos = positions.get(forkMessageId);
  if (forkPos === undefined) return undefined;
  const parentMeta = loadRunSessionsMap(jobId, runId)[parentSessionId];
  const snapshots = parentMeta?.usageSnapshots ?? [];
  let best: PersistedUsage | undefined;
  let bestPos = -1;
  for (const snap of snapshots) {
    const p = positions.get(snap.entryId);
    if (p === undefined) continue;
    if (p < forkPos && p > bestPos) {
      bestPos = p;
      best = snap.usage;
    }
  }
  if (best) return best;
  const u = parentMeta?.usage;
  const p = parentMeta?.priorRunsUsage;
  if (!u && !p) return undefined;
  return {
    inputTokens: (u?.inputTokens ?? 0) + (p?.inputTokens ?? 0),
    outputTokens: (u?.outputTokens ?? 0) + (p?.outputTokens ?? 0),
    cacheReadInputTokens: (u?.cacheReadInputTokens ?? 0) + (p?.cacheReadInputTokens ?? 0),
    cacheCreationInputTokens: (u?.cacheCreationInputTokens ?? 0) + (p?.cacheCreationInputTokens ?? 0),
    costUSD: (u?.costUSD ?? 0) + (p?.costUSD ?? 0),
  };
}

// Mirror of rollSessionUsageOnResume (agent side). The SDK reports cost
// cumulative-per-process, so a resumed session's counter starts from zero.
// Roll the current-run usage into the prior-runs accumulator before the
// resume call so lifetime cost survives the reset.
export function rollRunSessionUsageOnResume(jobId: string, runId: string, sessionId: string) {
  const map = loadRunSessionsMap(jobId, runId);
  const existing = map[sessionId];
  if (!existing?.usage) return;
  const u = existing.usage;
  if (u.costUSD === 0 && u.inputTokens === 0 && u.outputTokens === 0 && u.cacheReadInputTokens === 0 && u.cacheCreationInputTokens === 0) return;
  const prior = existing.priorRunsUsage;
  const rolled: PersistedUsage = {
    inputTokens: (prior?.inputTokens ?? 0) + u.inputTokens,
    outputTokens: (prior?.outputTokens ?? 0) + u.outputTokens,
    cacheReadInputTokens: (prior?.cacheReadInputTokens ?? 0) + u.cacheReadInputTokens,
    cacheCreationInputTokens: (prior?.cacheCreationInputTokens ?? 0) + u.cacheCreationInputTokens,
    costUSD: (prior?.costUSD ?? 0) + u.costUSD,
  };
  map[sessionId] = { ...existing, priorRunsUsage: rolled, usage: undefined, lastModified: Date.now() };
  saveRunSessionsMap(jobId, runId, map);
}

export function accumulateRunSessionUsage(jobId: string, runId: string, sessionId: string, turnTokens: Omit<PersistedUsage, "costUSD">, runCostUSD: number): PersistedUsage {
  const map = loadRunSessionsMap(jobId, runId);
  const existing = map[sessionId] ?? { topic: null, lastModified: 0 };
  const prev = existing.usage;
  const next: PersistedUsage = {
    inputTokens: (prev?.inputTokens ?? 0) + turnTokens.inputTokens,
    outputTokens: (prev?.outputTokens ?? 0) + turnTokens.outputTokens,
    cacheReadInputTokens: (prev?.cacheReadInputTokens ?? 0) + turnTokens.cacheReadInputTokens,
    cacheCreationInputTokens: (prev?.cacheCreationInputTokens ?? 0) + turnTokens.cacheCreationInputTokens,
    costUSD: runCostUSD,
  };
  map[sessionId] = { ...existing, usage: next, lastModified: Date.now() };
  saveRunSessionsMap(jobId, runId, map);
  return next;
}

export function appendRunSessionUsageSnapshot(jobId: string, runId: string, sessionId: string, entryId: string, usage: PersistedUsage) {
  const map = loadRunSessionsMap(jobId, runId);
  const existing = map[sessionId] ?? { topic: null, lastModified: 0 };
  const snapshots = existing.usageSnapshots ?? [];
  const last = snapshots[snapshots.length - 1];
  if (last && last.entryId === entryId) {
    last.usage = usage;
  } else {
    snapshots.push({ entryId, usage });
  }
  map[sessionId] = { ...existing, usageSnapshots: snapshots, lastModified: Date.now() };
  saveRunSessionsMap(jobId, runId, map);
}

// ---------------------------------------------------------------------------
// Per-run JSONL append + load
// ---------------------------------------------------------------------------

export function appendRunLog(jobId: string, runId: string, sessionId: string, entry: LogEntry) {
  if (entry.ephemeral) return;
  entry = prepareLogEntry(entry);
  try {
    mkdirSync(runDir(jobId, runId), { recursive: true });
    appendFileSync(sessionLogFile(jobId, runId, sessionId), JSON.stringify(entry) + "\n");
  } catch (err) {
    console.error(`Failed to write run log ${jobId}/${runId}/${sessionId}:`, err);
  }
}

export function loadRunLog(jobId: string, runId: string, sessionId: string): LogEntry[] {
  try {
    const file = sessionLogFile(jobId, runId, sessionId);
    if (!existsSync(file)) return [];
    const content = readFileSync(file, "utf-8").trim();
    if (!content) return [];
    return content.split("\n").map((line) => JSON.parse(line) as LogEntry);
  } catch (err) {
    console.error(`Failed to load run log ${jobId}/${runId}/${sessionId}:`, err);
    return [];
  }
}

// Walk the fork chain and concatenate ancestor log entries the same way
// loadLogWithAncestors does for agents. For v1 cronjobs, runs typically have a
// single root session, but the structure supports forks via the same mechanism.
export function loadRunLogWithAncestors(jobId: string, runId: string, sessionId: string): LogEntry[] {
  const sessionsMap = loadRunSessionsMap(jobId, runId);
  const chain: { sessionId: string; forkMessageId?: string }[] = [];
  let current: string | undefined = sessionId;
  const visited = new Set<string>();
  while (current) {
    if (visited.has(current)) break;
    visited.add(current);
    const meta: RunSessionsMap[string] | undefined = sessionsMap[current];
    chain.unshift({ sessionId: current, forkMessageId: meta?.forkMessageId });
    current = meta?.forkedFrom;
  }
  const result: LogEntry[] = [];
  for (let i = 0; i < chain.length; i++) {
    const entries = loadRunLog(jobId, runId, chain[i].sessionId);
    if (i < chain.length - 1) {
      const cutoffId = chain[i + 1].forkMessageId;
      for (const entry of entries) {
        if (entry.id === cutoffId) break;
        result.push(entry);
      }
    } else {
      result.push(...entries);
    }
  }
  return result;
}
