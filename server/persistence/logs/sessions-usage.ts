import { loadSessionsMap, saveSessionsMap, type PersistedUsage } from "./sessions.ts";

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
