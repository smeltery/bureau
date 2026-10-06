import type { CronjobRun } from "../../shared/types.ts";
import { loadRuns, loadRunSessionsMap, type PersistedUsage } from "../persistence.ts";

export interface CronjobLifetimeUsage {
  totalIn: number;
  cacheRead: number;
  cacheCreation: number;
  totalOut: number;
  costUSD: number;
}

export function readCronjobLifetimeUsage(jobId: string, visible: (run: CronjobRun) => boolean = () => true): CronjobLifetimeUsage {
  const totals = { totalIn: 0, cacheRead: 0, cacheCreation: 0, totalOut: 0, costUSD: 0 };
  const runs = loadRuns(jobId);
  for (const run of runs.filter(visible)) {
    const map = loadRunSessionsMap(jobId, run.id);
    for (const entry of Object.values(map)) {
      const u: PersistedUsage | undefined = entry.usage;
      const p: PersistedUsage | undefined = entry.priorRunsUsage;
      const base: PersistedUsage | undefined = entry.forkBaseUsage;
      const inputTokens = (u?.inputTokens ?? 0) + (p?.inputTokens ?? 0);
      const outputTokens = (u?.outputTokens ?? 0) + (p?.outputTokens ?? 0);
      const cacheReadInputTokens = (u?.cacheReadInputTokens ?? 0) + (p?.cacheReadInputTokens ?? 0);
      const cacheCreationInputTokens = (u?.cacheCreationInputTokens ?? 0) + (p?.cacheCreationInputTokens ?? 0);
      const costUSD = (u?.costUSD ?? 0) + (p?.costUSD ?? 0);
      totals.totalIn += inputTokens + cacheReadInputTokens + cacheCreationInputTokens - ((base?.inputTokens ?? 0) + (base?.cacheReadInputTokens ?? 0) + (base?.cacheCreationInputTokens ?? 0));
      totals.cacheRead += cacheReadInputTokens - (base?.cacheReadInputTokens ?? 0);
      totals.cacheCreation += cacheCreationInputTokens - (base?.cacheCreationInputTokens ?? 0);
      totals.totalOut += outputTokens - (base?.outputTokens ?? 0);
      totals.costUSD += costUSD - (base?.costUSD ?? 0);
    }
  }
  return totals;
}
