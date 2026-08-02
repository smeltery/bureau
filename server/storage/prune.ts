import { dirname, join, resolve, sep } from "path";
import { lstatSync, readdirSync, readFileSync, realpathSync, unlinkSync } from "fs";
import type { PruneCandidateWire, PrunePlanWire, PruneSkipReason, PruneSkipWire, PruneTarget } from "../../shared/storage-types.ts";

export interface PruneOptions {
  olderThanDays: number;
  keepPerAgent: number;
}

export interface PruneDeps {
  logsDir: string;
  now: number;
  activeSessionIds: ReadonlySet<string>;
  loadSessionsMap(agentId: string): Record<string, { forkedFrom?: string }>;
  queuedAttachments(agentId: string): ReadonlySet<string>;
}

interface SkipLedger {
  totals: Map<PruneSkipReason, PruneSkipWire>;
  byPath: Map<string, PruneSkipReason>;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const FILENAME_REF = /"filename"\s*:\s*"((?:[^"\\]|\\.)*)"/g;
const SKIP_ORDER: PruneSkipReason[] = ["active-session", "keep-newest", "fork-ancestor", "referenced", "too-recent"];

function newLedger(): SkipLedger {
  return { totals: new Map(), byPath: new Map() };
}

function addSkip(ledger: SkipLedger, path: string, reason: PruneSkipReason, bytes: number) {
  const prev = ledger.totals.get(reason) ?? { reason, count: 0, bytes: 0 };
  prev.count += 1;
  prev.bytes += bytes;
  ledger.totals.set(reason, prev);
  ledger.byPath.set(path, reason);
}

function listAgentDirs(logsDir: string): string[] {
  try {
    return readdirSync(logsDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && entry.name.startsWith("agent-"))
      .map((entry) => entry.name);
  } catch {
    return [];
  }
}

function isRealDir(path: string): boolean {
  try {
    return lstatSync(path).isDirectory();
  } catch {
    return false;
  }
}

function finishPlan(target: PruneTarget, options: PruneOptions, candidates: PruneCandidateWire[], ledger: SkipLedger): PrunePlanWire {
  candidates.sort((a, b) => b.bytes - a.bytes);
  return {
    target,
    policy: { olderThanDays: options.olderThanDays, keepPerAgent: options.keepPerAgent },
    candidates,
    bytes: candidates.reduce((sum, candidate) => sum + candidate.bytes, 0),
    skipped: SKIP_ORDER.map((reason) => ledger.totals.get(reason)).filter((skip): skip is PruneSkipWire => skip !== undefined),
  };
}

function planTranscripts(deps: PruneDeps, options: PruneOptions, ledger: SkipLedger): PrunePlanWire {
  const cutoff = deps.now - options.olderThanDays * DAY_MS;
  const candidates: PruneCandidateWire[] = [];

  for (const agentId of listAgentDirs(deps.logsDir)) {
    const agentDir = join(deps.logsDir, agentId);
    let entries;
    try {
      entries = readdirSync(agentDir, { withFileTypes: true });
    } catch {
      continue;
    }

    const files = entries
      .filter((entry) => entry.isFile() && entry.name.endsWith(".jsonl"))
      .flatMap((entry) => {
        try {
          const stat = lstatSync(join(agentDir, entry.name));
          return [{ sessionId: entry.name.slice(0, -".jsonl".length), bytes: stat.size, mtimeMs: stat.mtimeMs }];
        } catch {
          return [];
        }
      })
      .sort((a, b) => b.mtimeMs - a.mtimeMs);

    const forkAncestors = new Set<string>();
    for (const meta of Object.values(deps.loadSessionsMap(agentId))) {
      if (meta?.forkedFrom) forkAncestors.add(meta.forkedFrom);
    }

    files.forEach((file, index) => {
      const path = join(agentId, `${file.sessionId}.jsonl`);
      if (deps.activeSessionIds.has(file.sessionId)) return addSkip(ledger, path, "active-session", file.bytes);
      if (index < options.keepPerAgent) return addSkip(ledger, path, "keep-newest", file.bytes);
      if (forkAncestors.has(file.sessionId)) return addSkip(ledger, path, "fork-ancestor", file.bytes);
      if (file.mtimeMs > cutoff) return addSkip(ledger, path, "too-recent", file.bytes);
      candidates.push({
        path,
        bytes: file.bytes,
        agentId,
        sessionId: file.sessionId,
        ageDays: Math.floor((deps.now - file.mtimeMs) / DAY_MS),
        mtimeMs: file.mtimeMs,
      });
    });
  }

  return finishPlan("transcripts", options, candidates, ledger);
}

function referencedAttachments(agentDir: string): Set<string> {
  const referenced = new Set<string>();
  let entries;
  try {
    entries = readdirSync(agentDir, { withFileTypes: true });
  } catch {
    return referenced;
  }
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".jsonl")) continue;
    const raw = readFileSync(join(agentDir, entry.name), "utf8");
    for (const match of raw.matchAll(FILENAME_REF)) {
      referenced.add(match[1]);
      try {
        referenced.add(JSON.parse(`"${match[1]}"`) as string);
      } catch {}
    }
  }
  return referenced;
}

function planAttachments(deps: PruneDeps, options: PruneOptions, ledger: SkipLedger): PrunePlanWire {
  const cutoff = deps.now - options.olderThanDays * DAY_MS;
  const candidates: PruneCandidateWire[] = [];

  for (const agentId of listAgentDirs(deps.logsDir)) {
    const agentDir = join(deps.logsDir, agentId);
    const filesDir = join(agentDir, "files");
    if (!isRealDir(filesDir)) continue;

    let entries;
    try {
      entries = readdirSync(filesDir, { withFileTypes: true });
    } catch {
      continue;
    }

    let referenced: Set<string>;
    try {
      referenced = referencedAttachments(agentDir);
      for (const queued of deps.queuedAttachments(agentId)) referenced.add(queued);
    } catch {
      for (const entry of entries) {
        if (!entry.isFile()) continue;
        try {
          const stat = lstatSync(join(filesDir, entry.name));
          addSkip(ledger, join(agentId, "files", entry.name), "referenced", stat.size);
        } catch {}
      }
      continue;
    }

    for (const entry of entries) {
      if (!entry.isFile()) continue;
      const path = join(agentId, "files", entry.name);
      let stat;
      try {
        stat = lstatSync(join(filesDir, entry.name));
      } catch {
        continue;
      }
      if (referenced.has(entry.name)) {
        addSkip(ledger, path, "referenced", stat.size);
        continue;
      }
      if (stat.mtimeMs > cutoff) {
        addSkip(ledger, path, "too-recent", stat.size);
        continue;
      }
      candidates.push({
        path,
        bytes: stat.size,
        agentId,
        ageDays: Math.floor((deps.now - stat.mtimeMs) / DAY_MS),
        mtimeMs: stat.mtimeMs,
      });
    }
  }

  return finishPlan("attachments", options, candidates, ledger);
}

function planDetailed(target: PruneTarget, options: PruneOptions, deps: PruneDeps): { plan: PrunePlanWire; sparedBy: Map<string, PruneSkipReason> } {
  const ledger = newLedger();
  const plan = target === "transcripts" ? planTranscripts(deps, options, ledger) : planAttachments(deps, options, ledger);
  return { plan, sparedBy: ledger.byPath };
}

export function planPrune(target: PruneTarget, options: PruneOptions, deps: PruneDeps): PrunePlanWire {
  return planDetailed(target, options, deps).plan;
}

export function resolveCandidatePath(logsDir: string, relative: string): string | null {
  if (relative === "" || relative.startsWith("/") || relative.startsWith("\\")) return null;
  const root = resolve(logsDir);
  const target = resolve(root, relative);
  return target.startsWith(root + sep) ? target : null;
}

function parentInside(realLogsRoot: string, absCandidate: string): boolean {
  try {
    const realParent = realpathSync(dirname(absCandidate));
    return realParent === realLogsRoot || realParent.startsWith(realLogsRoot + sep);
  } catch {
    return false;
  }
}

function noSymlinkParents(logsRoot: string, relPath: string): boolean {
  const parts = relPath.split(/[/\\]/).filter(Boolean);
  if (parts.length === 0) return false;
  let prefix = logsRoot;
  for (const part of parts.slice(0, -1)) {
    prefix = join(prefix, part);
    try {
      if (!lstatSync(prefix).isDirectory()) return false;
    } catch {
      return false;
    }
  }
  return true;
}

export function applyPrune(plan: PrunePlanWire, deps: PruneDeps): { deleted: number; bytes: number; refused: { path: string; reason: string }[]; aborted?: string } {
  const resolved = new Map<string, string>();
  for (const candidate of plan.candidates) {
    const abs = resolveCandidatePath(deps.logsDir, candidate.path);
    if (abs === null) {
      return { deleted: 0, bytes: 0, refused: [{ path: candidate.path, reason: "outside-logs-dir" }], aborted: `candidate escapes logs root: ${candidate.path}` };
    }
    resolved.set(candidate.path, abs);
  }

  let realLogsRoot: string;
  try {
    realLogsRoot = realpathSync(deps.logsDir);
  } catch {
    return { deleted: 0, bytes: 0, refused: [], aborted: `logs root is not resolvable: ${deps.logsDir}` };
  }

  const { plan: fresh, sparedBy } = planDetailed(plan.target, plan.policy, deps);
  const approved = new Map(fresh.candidates.map((candidate) => [candidate.path, candidate]));
  const refused: { path: string; reason: string }[] = [];
  let deleted = 0;
  let bytes = 0;

  for (const candidate of plan.candidates) {
    const live = approved.get(candidate.path);
    const abs = resolved.get(candidate.path)!;
    if (!live) {
      const reason = sparedBy.get(candidate.path);
      refused.push({ path: candidate.path, reason: reason ? `became-${reason}` : "missing" });
      continue;
    }
    if (live.mtimeMs !== candidate.mtimeMs) {
      refused.push({ path: candidate.path, reason: "modified-since-plan" });
      continue;
    }
    if (!parentInside(realLogsRoot, abs) || !noSymlinkParents(realLogsRoot, candidate.path)) {
      refused.push({ path: candidate.path, reason: "parent-escapes-logs-dir" });
      continue;
    }
    try {
      if (!lstatSync(abs).isFile()) {
        refused.push({ path: candidate.path, reason: "not-a-regular-file" });
        continue;
      }
      unlinkSync(abs);
      deleted += 1;
      bytes += live.bytes;
    } catch (err) {
      refused.push({ path: candidate.path, reason: err instanceof Error ? err.message : "unlink-failed" });
    }
  }

  return { deleted, bytes, refused };
}
