import { lstatSync, readdirSync, realpathSync, unlinkSync, type Stats } from "node:fs";
import { join } from "node:path";
import type { PruneApplyWire, PrunePlanWire, PruneSkipReason } from "../../shared/storage-types.ts";

export type LogPruneTarget = "token-logs" | "terminal-recordings";
export interface LogPruneDeps {
  stateRoot: string;
  now: number;
  isRecordingActive: (id: string) => boolean;
  preserveTokenSequence: (id: string) => void;
  tokenLogRemoved: (id: string) => void;
}
const patterns: Record<LogPruneTarget, RegExp> = {
  "token-logs": /^[a-f0-9]{16}\.jsonl$/,
  "terminal-recordings": /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}\.jsonl$/,
};
const DAY = 86_400_000;
interface Snapshot {
  target: LogPruneTarget;
  directory: string;
  directoryStat: Stats;
  files: Map<string, Stats>;
}
const snapshots = new WeakMap<PrunePlanWire, Snapshot>();
function sameFile(a: Stats, b: Stats) {
  return a.dev === b.dev && a.ino === b.ino && a.size === b.size && a.mtimeMs === b.mtimeMs && a.ctimeMs === b.ctimeMs;
}
export function planLogPrune(target: LogPruneTarget, olderThanDays: number, deps: LogPruneDeps): PrunePlanWire {
  if (!Number.isSafeInteger(olderThanDays) || olderThanDays < 1 || olderThanDays > 36500) throw new Error("olderThanDays must be from 1 to 36500");
  const plan: PrunePlanWire = { target, policy: { olderThanDays, keepPerAgent: 0 }, candidates: [], bytes: 0, skipped: [] };
  const dir = join(deps.stateRoot, target);
  let stat: Stats;
  try {
    stat = lstatSync(dir);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return plan;
    throw error;
  }
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error("Log directory must be a real directory");
  const snapshot: Snapshot = { target, directory: realpathSync(dir), directoryStat: stat, files: new Map() };
  snapshots.set(plan, snapshot);
  const skipped = new Map<PruneSkipReason, { reason: PruneSkipReason; count: number; bytes: number }>();
  for (const name of readdirSync(dir).sort()) {
    if (!patterns[target].test(name)) continue;
    let file: Stats;
    try {
      file = lstatSync(join(dir, name));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
      throw error;
    }
    if (!file.isFile()) continue;
    const age = (deps.now - file.mtimeMs) / DAY;
    const reason = target === "terminal-recordings" && deps.isRecordingActive(name.slice(0, -6)) ? "active-recording" : age < olderThanDays ? "too-recent" : null;
    if (reason) {
      const entry = skipped.get(reason) ?? { reason, count: 0, bytes: 0 };
      entry.count++;
      entry.bytes += file.size;
      skipped.set(reason, entry);
      continue;
    }
    const path = `${target}/${name}`;
    plan.candidates.push({ path, bytes: file.size, ageDays: Math.floor(age), mtimeMs: file.mtimeMs });
    plan.bytes += file.size;
    snapshot.files.set(path, file);
  }
  plan.skipped = [...skipped.values()];
  return plan;
}
export function applyLogPrune(plan: PrunePlanWire, deps: LogPruneDeps): PruneApplyWire {
  const result: PruneApplyWire = { deleted: 0, bytes: 0, refused: [] };
  const snapshot = snapshots.get(plan);
  if (snapshot && snapshot.target !== plan.target) return { ...result, aborted: "Preview target changed" };
  if (!snapshot) return { ...result, ...(plan.candidates.length ? { aborted: "Preview is no longer available" } : {}) };
  for (const candidate of plan.candidates) {
    const original = snapshot.files.get(candidate.path);
    if (!original) {
      result.refused.push({ path: candidate.path, reason: "not-in-preview" });
      continue;
    }
    const name = candidate.path.slice(plan.target.length + 1);
    const id = name.slice(0, -6);
    try {
      const directory = join(deps.stateRoot, plan.target);
      const dirStat = lstatSync(directory);
      if (!dirStat.isDirectory() || dirStat.dev !== snapshot.directoryStat.dev || dirStat.ino !== snapshot.directoryStat.ino || realpathSync(directory) !== snapshot.directory)
        throw new Error("directory-changed");
      const path = join(snapshot.directory, name);
      const current = lstatSync(path);
      if (!current.isFile() || !sameFile(original, current)) throw new Error("modified-since-preview");
      if (plan.target === "terminal-recordings" && deps.isRecordingActive(id)) throw new Error("active-recording");
      if (deps.now - current.mtimeMs < plan.policy.olderThanDays * DAY) throw new Error("too-recent");
      if (plan.target === "token-logs") {
        deps.preserveTokenSequence(id);
        if (!sameFile(current, lstatSync(path))) throw new Error("modified-during-counter-save");
      }
      unlinkSync(path);
      result.deleted++;
      result.bytes += current.size;
      if (plan.target === "token-logs") deps.tokenLogRemoved(id);
    } catch (error) {
      result.refused.push({ path: candidate.path, reason: error instanceof Error ? error.message : "delete-failed" });
    }
  }
  return result;
}
