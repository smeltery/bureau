// Bureau runs agent backends (the Claude/Codex CLI subprocesses, plus
// whatever a build or test run an agent kicks off) as descendants of this
// same process. When the box runs out of memory, the kernel's OOM killer
// picks a victim by "badness" — roughly memory footprint plus a per-process
// `oom_score_adj` — and that adjustment is inherited across fork/exec. Left
// alone, an agent and the multi-gigabyte build it starts both carry the
// office server's own adjustment, so the killer cannot tell the office apart
// from the thing that actually ran away with memory. Picking the office means
// every agent in it dies at once, not just the one that misbehaved.
//
// This module biases things back: it walks the office's own descendant
// processes and raises each one's `oom_score_adj` well above the office's,
// so a starved kernel reaches for an agent (or whatever the agent spawned)
// long before it reaches for the office itself. It is a strong bias, not a
// guarantee — memory footprint still matters, and nothing here promises which
// descendant goes.
//
// Raising an `oom_score_adj` needs no special privilege; only lowering one
// does. So this can run unprivileged on any install shape, with no root
// helper and no coordination with however the box happens to be managed.

import { readdirSync, readFileSync, writeFileSync } from "fs";

/**
 * The value stamped onto every descendant process.
 *
 * Ubuntu's per-user systemd slice already sets a self-hosted office to +100,
 * so the margin has to clear that by enough that ordinary memory-footprint
 * differences don't erase it. 300 leaves a wide gap above both that baseline
 * and a hosted box's more negative starting point.
 */
export const AGENT_OOM_SCORE_ADJ = 300;

/** How often to re-sweep for newly spawned descendants. */
export const OOM_SWEEP_INTERVAL_MS = 10_000;

const DEFAULT_PROC_ROOT = "/proc";

/** The two `stat` fields that identify a process and place it in the tree. */
type ProcInfo = { ppid: number; starttime: string };

export type StampOutcome = "stamped" | "already" | "skipped" | "refused";

export interface OomSweepResult {
  stamped: number[];
  already: number;
  skipped: number;
  refused: { pid: number; detail: string }[];
}

/**
 * Read one process's parent pid and start time from `/proc/[pid]/stat`.
 *
 * A bare pid can be recycled, so the pairing with start time is what actually
 * identifies "the same process" across two reads. The process name (field 2)
 * can itself contain spaces and parentheses, so fields are located from the
 * *last* `") "` rather than by splitting on whitespace from the start.
 */
function readProcInfo(procRoot: string, pid: number): ProcInfo | null {
  let raw: string;
  try {
    raw = readFileSync(`${procRoot}/${pid}/stat`, "utf8");
  } catch {
    return null;
  }
  const afterName = raw.lastIndexOf(") ");
  if (afterName < 0) return null;
  const fields = raw.slice(afterName + 2).split(" ");
  // Field numbering in proc(5) is 1-based and includes the two we already
  // consumed (pid, comm), so field N lives at index N - 3 here.
  const ppid = Number(fields[1]);
  const starttime = fields[19];
  if (!Number.isInteger(ppid) || !starttime) return null;
  return { ppid, starttime };
}

function readAdj(procRoot: string, pid: number): number | null {
  let raw: string;
  try {
    raw = readFileSync(`${procRoot}/${pid}/oom_score_adj`, "utf8");
  } catch {
    return null;
  }
  const trimmed = raw.trim();
  if (!/^-?\d+$/.test(trimmed)) return null;
  return Number(trimmed);
}

/**
 * Every descendant of `rootPid`, discovered by scanning the whole process
 * table rather than `/proc/[pid]/task/[pid]/children` — the kernel documents
 * that file as unreliable for a running task, which every task here is.
 *
 * Traversal is breadth-first so a parent is always visited before its
 * children, which matters for the sweep: a child born mid-sweep inherits
 * whatever its parent already carries.
 */
export function descendantsOf(procRoot: string, rootPid: number): Map<number, ProcInfo> {
  let entries: string[];
  try {
    entries = readdirSync(procRoot);
  } catch {
    return new Map();
  }

  const table = new Map<number, ProcInfo>();
  for (const entry of entries) {
    if (!/^\d+$/.test(entry)) continue;
    const pid = Number(entry);
    const info = readProcInfo(procRoot, pid);
    if (info) table.set(pid, info);
  }

  const childrenOf = new Map<number, number[]>();
  for (const [pid, info] of table) {
    const siblings = childrenOf.get(info.ppid);
    if (siblings) siblings.push(pid);
    else childrenOf.set(info.ppid, [pid]);
  }

  const found = new Map<number, ProcInfo>();
  const seen = new Set<number>([rootPid]);
  const queue = [rootPid];
  while (queue.length > 0) {
    const parent = queue.shift() as number;
    for (const pid of childrenOf.get(parent) ?? []) {
      if (seen.has(pid)) continue;
      seen.add(pid);
      const info = table.get(pid);
      if (info) found.set(pid, info);
      queue.push(pid);
    }
  }
  return found;
}

export interface StampOptions {
  procRoot: string;
  pid: number;
  /** What the sweep saw when it decided this pid belonged to us. */
  expected: ProcInfo;
  isOurs: (ppid: number) => boolean;
  target: number;
  /** Test seam for a write that succeeds but doesn't stick. */
  writeAdj?: (path: string, value: number) => void;
}

/**
 * Raise one process's `oom_score_adj` toward `target`, trusting only what a
 * readback confirms.
 *
 * Never lowers — a process below target already lost the coin flip against a
 * privilege check, and one that made itself a worse victim on purpose should
 * stay that way. The identity check (matching `starttime`) brackets the write
 * on both sides: a pid that exited and was handed to an unrelated process
 * between our snapshot and our write must not have its value attributed to
 * us, in either direction.
 */
export function stampProcess(opts: StampOptions): StampOutcome {
  const { procRoot, pid, expected, isOurs, target } = opts;
  const write = opts.writeAdj ?? defaultWriteAdj;

  const current = readAdj(procRoot, pid);
  if (current === null) return "skipped";
  if (current >= target) return "already";

  const before = readProcInfo(procRoot, pid);
  if (!before || before.starttime !== expected.starttime || !isOurs(before.ppid)) return "skipped";

  try {
    write(`${procRoot}/${pid}/oom_score_adj`, target);
  } catch {
    // A process that exited mid-write is ordinary churn; anything else is a
    // refusal worth naming.
    return readProcInfo(procRoot, pid) ? "refused" : "skipped";
  }

  const after = readProcInfo(procRoot, pid);
  if (!after || after.starttime !== expected.starttime) return "skipped";
  const actual = readAdj(procRoot, pid);
  // At or above, not equal: a process that raised itself further between our
  // write and our read still satisfies what we asked for.
  if (actual === null || actual < target) return "refused";
  return "stamped";
}

function defaultWriteAdj(path: string, value: number): void {
  writeFileSync(path, String(value));
}

export interface OomStamperOptions {
  procRoot?: string;
  rootPid?: number;
  target?: number;
  log?: (message: string) => void;
  warn?: (message: string) => void;
  writeAdj?: (path: string, value: number) => void;
}

/**
 * Build a sweep function that can be called repeatedly. Quiet in the steady
 * state: it only logs the first time it actually stamps something, and warns
 * at most once if a stamp is refused.
 */
export function createAgentOomStamper(opts: OomStamperOptions = {}): { sweep: () => OomSweepResult } {
  const procRoot = opts.procRoot ?? DEFAULT_PROC_ROOT;
  const rootPid = opts.rootPid ?? process.pid;
  const target = opts.target ?? AGENT_OOM_SCORE_ADJ;
  const log = opts.log ?? ((m: string) => console.log(m));
  const warn = opts.warn ?? ((m: string) => console.warn(m));
  let announced = false;
  let warned = false;

  return {
    sweep(): OomSweepResult {
      const result: OomSweepResult = { stamped: [], already: 0, skipped: 0, refused: [] };
      const tree = descendantsOf(procRoot, rootPid);
      const isOurs = (ppid: number) => ppid === rootPid || tree.has(ppid);

      for (const [pid, expected] of tree) {
        const outcome = stampProcess({ procRoot, pid, expected, isOurs, target, writeAdj: opts.writeAdj });
        if (outcome === "stamped") result.stamped.push(pid);
        else if (outcome === "already") result.already += 1;
        else if (outcome === "skipped") result.skipped += 1;
        else result.refused.push({ pid, detail: `the kernel reports ${readAdj(procRoot, pid) ?? "nothing"}` });
      }

      if (!announced && result.stamped.length > 0) {
        announced = true;
        const own = readAdj(procRoot, rootPid);
        log(
          `[oom] biasing the office's own spawned processes toward being killed before the office server (target oom_score_adj=${target}; office is at ${own ?? "an unknown value"}). A runaway agent or build is now much more likely to be the one the kernel picks.`,
        );
      }
      if (!warned && result.refused.length > 0) {
        warned = true;
        const { pid, detail } = result.refused[0];
        warn(`[oom] could not raise pid ${pid}'s oom_score_adj (asked for ${target}, ${detail}). Under memory pressure the office is more exposed than it should be. Logged once per run.`);
      }
      return result;
    },
  };
}

/**
 * Start sweeping on an interval. Returns a function that stops it.
 *
 * A no-op off Linux — a self-hosted office on macOS has no `/proc` and no
 * `oom_score_adj`, and runs exactly as well without this; it's protection
 * metadata, not part of serving the office.
 */
export function startAgentOomStamping(opts: OomStamperOptions = {}): () => void {
  if (process.platform !== "linux") return () => {};
  const stamper = createAgentOomStamper(opts);
  const sweep = () => {
    try {
      stamper.sweep();
    } catch (err) {
      console.error("[oom] stamp sweep failed:", err);
    }
  };
  sweep();
  const timer = setInterval(sweep, OOM_SWEEP_INTERVAL_MS);
  timer.unref?.();
  return () => clearInterval(timer);
}
