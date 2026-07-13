import { loadLog, loadSessionsMap, type PersistedUsage } from "../../persistence.ts";
import { emptyBucket, type UsageBucket } from "../usage-format.ts";

// Read an agent's per-session usage off disk and aggregate into:
//   - session: usage for `currentSessionId` (the agent's active conversation)
//   - lifetime: sum of (entry.usage - entry.forkBaseUsage) across all entries
// `forkBaseUsage` is captured at fork creation by walking the parent's log to
// find the cumulative usage at the exact fork point, so each fork contributes
// only its own new work — no double-counting of the shared parent prefix.
export function readAgentUsage(agentId: string, currentSessionId: string | null): { session: UsageBucket; lifetime: UsageBucket } {
  const map = loadSessionsMap(agentId);
  const lifetime = emptyBucket();
  for (const entry of Object.values(map)) {
    if (!entry.usage && !entry.priorRunsUsage) continue;
    const u = entry.usage;
    const p = entry.priorRunsUsage;
    const base = entry.forkBaseUsage;
    // Session total = current-run + all prior completed runs (if any).
    const inputTokens = (u?.inputTokens ?? 0) + (p?.inputTokens ?? 0);
    const outputTokens = (u?.outputTokens ?? 0) + (p?.outputTokens ?? 0);
    const cacheReadInputTokens = (u?.cacheReadInputTokens ?? 0) + (p?.cacheReadInputTokens ?? 0);
    const cacheCreationInputTokens = (u?.cacheCreationInputTokens ?? 0) + (p?.cacheCreationInputTokens ?? 0);
    const costUSD = (u?.costUSD ?? 0) + (p?.costUSD ?? 0);
    lifetime.totalIn += inputTokens + cacheReadInputTokens + cacheCreationInputTokens - ((base?.inputTokens ?? 0) + (base?.cacheReadInputTokens ?? 0) + (base?.cacheCreationInputTokens ?? 0));
    lifetime.cacheRead += cacheReadInputTokens - (base?.cacheReadInputTokens ?? 0);
    lifetime.cacheCreation += cacheCreationInputTokens - (base?.cacheCreationInputTokens ?? 0);
    lifetime.totalOut += outputTokens - (base?.outputTokens ?? 0);
    lifetime.costUSD += costUSD - (base?.costUSD ?? 0);
  }
  const session = emptyBucket();
  const sessEntry = currentSessionId ? map[currentSessionId] : undefined;
  if (sessEntry && (sessEntry.usage || sessEntry.priorRunsUsage)) {
    const u = sessEntry.usage;
    const p = sessEntry.priorRunsUsage;
    session.totalIn =
      (u?.inputTokens ?? 0) + (p?.inputTokens ?? 0) + (u?.cacheReadInputTokens ?? 0) + (p?.cacheReadInputTokens ?? 0) + (u?.cacheCreationInputTokens ?? 0) + (p?.cacheCreationInputTokens ?? 0);
    session.cacheRead = (u?.cacheReadInputTokens ?? 0) + (p?.cacheReadInputTokens ?? 0);
    session.cacheCreation = (u?.cacheCreationInputTokens ?? 0) + (p?.cacheCreationInputTokens ?? 0);
    session.totalOut = (u?.outputTokens ?? 0) + (p?.outputTokens ?? 0);
    session.costUSD = (u?.costUSD ?? 0) + (p?.costUSD ?? 0);
  }
  return { session, lifetime };
}

// Locate a parent's cumulative usage at a fork point. Walks the parent's log
// to find `forkMessageId`'s position, then returns the latest snapshot whose
// anchor entry sits before that position. When the parent has no snapshots
// (e.g. it predates snapshot tracking), fall back to the parent's current
// cumulative `usage` — best-effort, slightly over-subtracts if the parent
// continued past the fork, but bounded and avoids a full prefix double-count
// in lifetime totals.
export function findUsageAtFork(agentId: string, parentSessionId: string, forkMessageId: string): PersistedUsage | undefined {
  const entries = loadLog(agentId, parentSessionId);
  const positions = new Map<string, number>();
  entries.forEach((e, i) => positions.set(e.id, i));
  const forkPos = positions.get(forkMessageId);
  if (forkPos === undefined) return undefined;
  const parentMeta = loadSessionsMap(agentId)[parentSessionId];
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
  // Fallback when no snapshot sits before the fork point: use the parent's
  // current cumulative (priorRunsUsage + usage). After a resume with no new
  // results yet, `usage` may be undefined while priorRunsUsage holds the real
  // value — sum both so forks off just-resumed parents still get a base.
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
