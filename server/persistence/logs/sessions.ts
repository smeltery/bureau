import { join } from "path";
import { mkdirSync, readFileSync, existsSync, readdirSync } from "fs";
import { atomicWriteFileSync, LOGS_DIR } from "../paths.ts";

// Per-session metadata storage: ~/.bureau/logs/<agentId>/sessions.json.
// - `usage` holds current-run accumulated usage. Token fields are summed as
//   each SDK `result` arrives (SDK reports tokens per-turn). `costUSD` is
//   overwritten (SDK reports cost cumulative-per-process). On resume, the
//   SDK's per-process counters restart, so this struct is rolled into
//   `priorRunsUsage` and reset to zero.
// - `priorRunsUsage` accumulates completed process-runs' final values.
//   Session lifetime = priorRunsUsage + usage.
// - `usageSnapshots` records cumulative usage after each turn, anchored to the
//   id of the last log entry written at that moment. /usage walks the parent's
//   log to find the snapshot at-or-before a fork point and subtracts it from
//   the fork's own cumulative — exact fork accounting with no double-count.
// - `forkBaseUsage` is the parent's cumulative-at-the-fork-point captured at
//   fork creation (resolved via the snapshots above).

export interface PersistedUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadInputTokens: number;
  cacheCreationInputTokens: number;
  costUSD: number;
}

type UsageSnapshot = { entryId: string; usage: PersistedUsage };
type SessionsMap = Record<
  string,
  {
    topic: string | null;
    // Count of user_message + text log entries at the moment the persisted
    // topic was last generated. Used on resume/startup to detect drift: if
    // the replayed log has materially more entries, the topic is stale and
    // worth regenerating. Missing on entries persisted before this field
    // existed — treated as 0 (regenerate aggressively).
    topicMessageCount?: number;
    lastModified: number;
    forkedFrom?: string;
    forkMessageId?: string;
    usage?: PersistedUsage;
    priorRunsUsage?: PersistedUsage;
    forkBaseUsage?: PersistedUsage;
    usageSnapshots?: UsageSnapshot[];
  }
>;

export function loadSessionsMap(agentId: string): SessionsMap {
  try {
    const filePath = join(LOGS_DIR, agentId, "sessions.json");
    if (!existsSync(filePath)) return {};
    return JSON.parse(readFileSync(filePath, "utf-8")) as SessionsMap;
  } catch {
    return {};
  }
}

function saveSessionsMap(agentId: string, map: SessionsMap) {
  try {
    const agentDir = join(LOGS_DIR, agentId);
    mkdirSync(agentDir, { recursive: true });
    atomicWriteFileSync(join(agentDir, "sessions.json"), JSON.stringify(map, null, 2));
  } catch (err) {
    console.error("Failed to save sessions map:", err);
  }
}

export function persistSessionTopic(agentId: string, sessionId: string, topic: string | null, topicMessageCount: number = 0) {
  const map = loadSessionsMap(agentId);
  const existing = map[sessionId];
  map[sessionId] = { ...existing, topic, topicMessageCount, lastModified: Date.now() };
  saveSessionsMap(agentId, map);
}

export function persistSessionFork(agentId: string, sessionId: string, forkedFrom: string, forkMessageId: string, topic: string | null, topicMessageCount: number, forkBaseUsage?: PersistedUsage) {
  const map = loadSessionsMap(agentId);
  const existing = map[sessionId] ?? { topic: null, lastModified: 0 };
  map[sessionId] = { ...existing, topic, topicMessageCount, lastModified: Date.now(), forkedFrom, forkMessageId, ...(forkBaseUsage ? { forkBaseUsage } : {}) };
  saveSessionsMap(agentId, map);
}

// Accumulate a turn's usage into the session's current-run bucket. Token
// fields (per-turn from the SDK) are summed; cost (cumulative-per-process
// from the SDK) overwrites. Returns the resulting cumulative so callers can
// use it for downstream bookkeeping (e.g. snapshots).
export function accumulateSessionUsage(agentId: string, sessionId: string, turnTokens: Omit<PersistedUsage, "costUSD">, runCostUSD: number): PersistedUsage {
  const map = loadSessionsMap(agentId);
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
  saveSessionsMap(agentId, map);
  return next;
}

// Called at resume time to roll the current-run usage into the prior-runs
// accumulator so the SDK can reset its per-process counter without losing
// the cost already spent. No-op if nothing has been spent yet.
export function rollSessionUsageOnResume(agentId: string, sessionId: string) {
  const map = loadSessionsMap(agentId);
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
  saveSessionsMap(agentId, map);
}

export function appendSessionUsageSnapshot(agentId: string, sessionId: string, entryId: string, usage: PersistedUsage) {
  const map = loadSessionsMap(agentId);
  const existing = map[sessionId] ?? { topic: null, lastModified: 0 };
  const snapshots = existing.usageSnapshots ?? [];
  // Coalesce snapshots that share an entryId (multiple results with no log
  // activity between them — shouldn't happen, but keep the list compact).
  const last = snapshots[snapshots.length - 1];
  if (last && last.entryId === entryId) {
    last.usage = usage;
  } else {
    snapshots.push({ entryId, usage });
  }
  map[sessionId] = { ...existing, usageSnapshots: snapshots, lastModified: Date.now() };
  saveSessionsMap(agentId, map);
}

// List all sessions for an agent (sorted by most recent first), with topics from sessions.json
export function listAgentSessions(agentId: string): { sessionId: string; lastModified: number; topic: string | null; topicMessageCount: number; branched?: boolean; forked?: boolean }[] {
  try {
    const agentDir = join(LOGS_DIR, agentId);
    if (!existsSync(agentDir)) return [];
    const sessionsMap = loadSessionsMap(agentId);

    // Collect all forkedFrom values to detect which sessions have been branched FROM
    const branchedFromIds = new Set<string>();
    for (const entry of Object.values(sessionsMap)) {
      if (entry.forkedFrom) branchedFromIds.add(entry.forkedFrom);
    }

    return readdirSync(agentDir)
      .filter((f) => f.endsWith(".jsonl"))
      .map((f) => {
        const sid = f.replace(".jsonl", "");
        const entry = sessionsMap[sid];
        return {
          sessionId: sid,
          lastModified: entry?.lastModified ?? Bun.file(join(agentDir, f)).lastModified,
          topic: entry?.topic ?? null,
          topicMessageCount: entry?.topicMessageCount ?? 0,
          ...(branchedFromIds.has(sid) ? { branched: true as const } : {}),
          ...(entry?.forkedFrom ? { forked: true as const } : {}),
        };
      })
      .sort((a, b) => b.lastModified - a.lastModified);
  } catch {
    return [];
  }
}

// List every agent id that has a log directory on disk. Killed agents stay
// here even though they're gone from agents.json, so /usage can still account
// for their historical token spend.
export function listAllAgentIdsOnDisk(): string[] {
  try {
    if (!existsSync(LOGS_DIR)) return [];
    return readdirSync(LOGS_DIR, { withFileTypes: true })
      .filter((d) => d.isDirectory() && d.name.startsWith("agent-"))
      .map((d) => d.name);
  } catch {
    return [];
  }
}

// Find the most recent session log for an agent (by file modification time)
export function findLatestSession(agentId: string): string | null {
  try {
    const agentDir = join(LOGS_DIR, agentId);
    if (!existsSync(agentDir)) return null;
    const files = readdirSync(agentDir)
      .filter((f) => f.endsWith(".jsonl"))
      .map((f) => ({
        name: f.replace(".jsonl", ""),
        mtime: Bun.file(join(agentDir, f)).lastModified,
      }))
      .sort((a, b) => b.mtime - a.mtime);
    return files[0]?.name ?? null;
  } catch {
    return null;
  }
}
