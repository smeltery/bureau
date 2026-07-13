import type { CronjobRun, LogEntry } from "../../shared/types.ts";
import { findRun, listAllCronjobIdsOnDisk, loadRunLogWithAncestors, loadRuns } from "../persistence.ts";

export function getRunsForCronjob(jobId: string): CronjobRun[] {
  return loadRuns(jobId);
}

// Returns one entry per cronjob id that has a runs.json on disk — including
// jobs whose configs have since been deleted. The Runs tab uses this so
// historical runs from deleted cronjobs remain visible.
export function getAllRunsByJob(): { jobId: string; runs: CronjobRun[] }[] {
  return listAllCronjobIdsOnDisk().map((jobId) => ({ jobId, runs: loadRuns(jobId) }));
}

export function getRunTranscript(jobId: string, runId: string): { run: CronjobRun | null; entries: LogEntry[] } {
  const run = findRun(jobId, runId);
  if (!run) return { run: null, entries: [] };
  // Walk back from the leaf of the fork chain so edit-to-fork transcripts
  // render correctly. Old runs without currentSessionId fall back to the
  // root — equivalent to the un-forked case.
  const leaf = run.currentSessionId ?? run.rootSessionId;
  const entries = loadRunLogWithAncestors(jobId, runId, leaf);
  return { run, entries };
}
