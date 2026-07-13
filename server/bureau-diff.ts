import type { DiffFileSummary, DiffPayload } from "../shared/types.ts";
import { execSync } from "child_process";
import { statSync } from "fs";
import { isAbsolute, join, resolve } from "path";
import { homedir } from "os";
import { applyNameStatus, applyNumstat } from "./bureau-diff-summary.ts";
import { synthesizeUntrackedPatches } from "./bureau-diff-untracked.ts";

export type ComputeDiffResult =
  | { kind: "ok"; cwd: string; summary: string; payload: DiffPayload }
  | { kind: "clean"; cwd: string }
  | { kind: "not_repo"; cwd: string }
  | { kind: "git_error"; cwd: string; message: string }
  | { kind: "bad_commit"; cwd: string; attempted: string; message: string };

export type ResolveDirResult = { kind: "ok"; cwd: string } | { kind: "bad_dir"; attempted: string };
type CommitSpec = { kind: "single"; ref: string } | { kind: "range"; raw: string };

const REF_CHARS = /^[A-Za-z0-9._\-/~^@:]+$/;

export function parseCommitArg(raw: string): { ok: true; spec: CommitSpec } | { ok: false; reason: string } {
  const trimmed = raw.trim();
  if (!trimmed) return { ok: false, reason: "empty commit string" };

  let runStart = -1;
  let runLen = 0;
  for (let i = 0; i < trimmed.length; i++) {
    if (trimmed[i] !== ".") continue;
    let j = i;
    while (j < trimmed.length && trimmed[j] === ".") j++;
    const len = j - i;
    if (len >= 2) {
      if (len > 3) return { ok: false, reason: "too many dots in range" };
      if (runStart !== -1) return { ok: false, reason: "multiple range operators" };
      runStart = i;
      runLen = len;
    }
    i = j - 1;
  }

  if (runStart === -1) {
    if (!REF_CHARS.test(trimmed)) return { ok: false, reason: "invalid characters in ref" };
    return { ok: true, spec: { kind: "single", ref: trimmed } };
  }

  const left = trimmed.slice(0, runStart);
  const right = trimmed.slice(runStart + runLen);
  if (!left || !right) return { ok: false, reason: "range operator requires both sides" };
  if (!REF_CHARS.test(left) || !REF_CHARS.test(right)) return { ok: false, reason: "invalid characters in range" };
  return { ok: true, spec: { kind: "range", raw: trimmed } };
}

// Resolve an optional user-supplied directory against the agent's cwd.
// `~` expands to the user's home; relative paths resolve against `agentCwd`;
// absolute paths win. Validates that the result exists and is a directory.
export function resolveDiffCwd(rawDir: string | undefined, agentCwd: string): ResolveDirResult {
  const trimmed = rawDir?.trim();
  if (!trimmed) return { kind: "ok", cwd: agentCwd };
  const expanded = trimmed.startsWith("~") ? join(homedir(), trimmed.slice(1).replace(/^[/\\]/, "")) : trimmed;
  const abs = isAbsolute(expanded) ? expanded : resolve(agentCwd, expanded);
  try {
    if (!statSync(abs).isDirectory()) return { kind: "bad_dir", attempted: abs };
  } catch {
    return { kind: "bad_dir", attempted: abs };
  }
  return { kind: "ok", cwd: abs };
}

// Run `git diff` (HEAD vs working tree, plus untracked) at `cwd` and return a
// rich payload. Shells out to git but doesn't touch agent state, log cache,
// or broadcasts — callers format the result themselves. Both /bureau-diff
// and the HTTP endpoint share this so the on-screen rendering stays identical.
export function computeBureauDiff(cwd: string, opts?: { commit?: string }): ComputeDiffResult {
  // -c core.quotePath=false keeps non-ASCII / spaced paths in raw UTF-8 form
  // so the client splitter can match them by-path against name-status output.
  const runGit = (args: string, maxBuffer = 10 * 1024 * 1024) => execSync(`git -c core.quotePath=false ${args}`, { cwd, timeout: 10000, maxBuffer, stdio: ["ignore", "pipe", "pipe"] }).toString();
  const runGitOrNull = (args: string, maxBuffer?: number): string | null => {
    try {
      return runGit(args, maxBuffer);
    } catch {
      return null;
    }
  };

  try {
    runGit("rev-parse --is-inside-work-tree", 1024);
  } catch {
    return { kind: "not_repo", cwd };
  }

  let commitSpec: CommitSpec | null = null;
  let subject: string | null = null;
  let refArgs: string | null = null;
  if (opts?.commit && opts.commit.trim()) {
    const parsed = parseCommitArg(opts.commit);
    if (!parsed.ok) return { kind: "bad_commit", cwd, attempted: opts.commit, message: parsed.reason };
    commitSpec = parsed.spec;

    const verifyRef = (ref: string): boolean => runGitOrNull(`rev-parse --verify --quiet ${ref}^{commit}`, 1024) !== null;
    if (commitSpec.kind === "single") {
      if (!verifyRef(commitSpec.ref)) {
        return { kind: "bad_commit", cwd, attempted: opts.commit, message: `unknown ref: ${commitSpec.ref}` };
      }
      const hasParent = verifyRef(`${commitSpec.ref}^`);
      refArgs = hasParent ? `${commitSpec.ref}^ ${commitSpec.ref}` : `--root ${commitSpec.ref}`;
      subject = runGitOrNull(`show -s --format=%s ${commitSpec.ref}`, 16 * 1024)?.trim() || null;
    } else {
      const dotsIdx = commitSpec.raw.indexOf("..");
      const dotsLen = commitSpec.raw.startsWith("...", dotsIdx) ? 3 : 2;
      const left = commitSpec.raw.slice(0, dotsIdx);
      const right = commitSpec.raw.slice(dotsIdx + dotsLen);
      if (!verifyRef(left)) return { kind: "bad_commit", cwd, attempted: opts.commit, message: `unknown ref: ${left}` };
      if (!verifyRef(right)) return { kind: "bad_commit", cwd, attempted: opts.commit, message: `unknown ref: ${right}` };
      refArgs = commitSpec.raw;
      subject = commitSpec.raw;
    }
  }

  const branchRaw = runGitOrNull("rev-parse --abbrev-ref HEAD", 1024)?.trim() ?? null;
  const branch = commitSpec === null && branchRaw && branchRaw !== "HEAD" ? branchRaw : null;
  let head: string | null = null;
  if (commitSpec === null) {
    head = runGitOrNull("rev-parse --short HEAD", 1024)?.trim() || null;
  } else if (commitSpec.kind === "single") {
    head = runGitOrNull(`rev-parse --short ${commitSpec.ref}`, 1024)?.trim() || null;
  }

  const gather = (refArgs: string) => ({
    diff: runGit(`diff ${refArgs}`.trim(), 50 * 1024 * 1024),
    numstat: runGit(`diff ${refArgs} --numstat`.trim()).trim(),
    nameStatus: runGit(`diff ${refArgs} --name-status`.trim()).trim(),
  });
  let diff = "";
  let numstat = "";
  let nameStatus = "";
  let untracked: string[] = [];
  try {
    if (refArgs !== null) {
      ({ diff, numstat, nameStatus } = gather(refArgs));
    } else if (head !== null) {
      ({ diff, numstat, nameStatus } = gather("HEAD"));
    } else {
      const cached = gather("--cached");
      const wd = gather("");
      diff = [cached.diff, wd.diff].filter((s) => s.trim()).join("\n");
      numstat = [cached.numstat, wd.numstat].filter(Boolean).join("\n");
      nameStatus = [cached.nameStatus, wd.nameStatus].filter(Boolean).join("\n");
    }
    if (commitSpec === null) {
      const untrackedOut = runGit("ls-files --others --exclude-standard").trim();
      if (untrackedOut) untracked = untrackedOut.split("\n");
    }
  } catch (err) {
    return { kind: "git_error", cwd, message: err instanceof Error ? err.message : String(err) };
  }

  const fileMap = new Map<string, DiffFileSummary>();
  applyNameStatus(fileMap, nameStatus);
  applyNumstat(fileMap, numstat);
  const untrackedPatches = synthesizeUntrackedPatches(cwd, untracked, fileMap);

  let patchText: string | null = diff;
  if (untrackedPatches.length > 0) {
    const trail = patchText && !patchText.endsWith("\n") ? "\n" : "";
    patchText = (patchText ?? "") + trail + untrackedPatches.join("\n") + "\n";
  }
  if (patchText !== null && patchText.trim() === "") patchText = null;

  for (const summary of fileMap.values()) {
    const hasTextualPatch = patchText !== null && summary.status !== "binary" && summary.status !== "untracked";
    summary.inlineEligible = hasTextualPatch && summary.lineCount <= 500;
  }

  // 2 MB safety rail: drop patchText, keep summaries.
  const MAX_PATCH_BYTES = 2 * 1024 * 1024;
  let truncated = false;
  if (patchText !== null && Buffer.byteLength(patchText, "utf8") > MAX_PATCH_BYTES) {
    patchText = null;
    truncated = true;
    for (const summary of fileMap.values()) summary.inlineEligible = false;
  }

  const files = Array.from(fileMap.values()).sort((a, b) => a.path.localeCompare(b.path));
  const stats = files.reduce(
    (acc, f) => ({
      additions: acc.additions + f.additions,
      deletions: acc.deletions + f.deletions,
      filesChanged: acc.filesChanged + 1,
    }),
    { additions: 0, deletions: 0, filesChanged: 0 },
  );

  if (files.length === 0) return { kind: "clean", cwd };

  const summary = `+${stats.additions} -${stats.deletions} across ${stats.filesChanged} file${stats.filesChanged === 1 ? "" : "s"}`;
  const payload: DiffPayload = { cwd, branch, head, subject, stats, files, patchText, truncated };
  return { kind: "ok", cwd, summary, payload };
}
