import { basename } from "path";
import { existsSync, readFileSync, statSync } from "fs";
import type { Attachment, LogEntry } from "../../shared/types.ts";
import { computeBureauDiff, resolveDiffCwd } from "../bureau-diff.ts";
import { resolveEditorPath } from "../file-editor.ts";
import { mimeTypeForFilename } from "../mime-types.ts";
import { findRun, saveFile } from "../persistence.ts";

const MAX_READ_FILE_BYTES = 20 * 1024 * 1024;

export interface AffordanceActiveRun {
  jobId: string;
  runId: string;
  streamId: string;
}

export type RunAffordanceResult = { ok: true } | { ok: false; status: number; error: string };

export type RunLogWriter = (
  active: AffordanceActiveRun,
  kind: LogEntry["kind"],
  content: string,
  metadata?: Record<string, unknown>,
  attachments?: Attachment[],
  extra?: Partial<Pick<LogEntry, "diff" | "file" | "terminal">>,
) => void;

export function emitRunReadFileWithDeps(activeRuns: Map<string, AffordanceActiveRun>, writeLog: RunLogWriter, jobId: string, runId: string, rawPath: string): RunAffordanceResult {
  const active = activeRuns.get(runId);
  if (!active || active.jobId !== jobId) return { ok: false, status: 409, error: "run is not active" };

  const run = findRun(jobId, runId);
  const cwd = run?.cwdSnapshot;
  if (!cwd) return { ok: false, status: 404, error: "run not found" };

  const resolved = resolveEditorPath(rawPath, cwd);
  if (resolved.kind === "bad_path") return { ok: false, status: 400, error: "missing or empty path" };

  const absPath = resolved.path;
  if (!existsSync(absPath)) {
    writeLog(active, "system", `\`${absPath}\` does not exist.`);
    return { ok: true };
  }

  let st;
  try {
    st = statSync(absPath);
  } catch (err) {
    writeLog(active, "system", `Failed to read \`${absPath}\`: ${err instanceof Error ? err.message : String(err)}`);
    return { ok: true };
  }
  if (!st.isFile()) {
    writeLog(active, "system", `\`${absPath}\` is not a file.`);
    return { ok: true };
  }
  if (st.size > MAX_READ_FILE_BYTES) {
    writeLog(active, "system", `\`${absPath}\` is ${(st.size / (1024 * 1024)).toFixed(1)} MB — too large to display (${MAX_READ_FILE_BYTES / (1024 * 1024)} MB limit).`);
    return { ok: true };
  }

  let data: Buffer;
  try {
    data = readFileSync(absPath);
  } catch (err) {
    writeLog(active, "system", `Failed to read \`${absPath}\`: ${err instanceof Error ? err.message : String(err)}`);
    return { ok: true };
  }

  const originalName = basename(absPath);
  const mediaType = mimeTypeForFilename(originalName);
  const att = saveFile(active.streamId, data, mediaType, originalName);
  if (!att) {
    writeLog(active, "system", `Failed to save \`${absPath}\` for display.`);
    return { ok: true };
  }
  writeLog(active, "file-view", originalName, undefined, [att]);
  return { ok: true };
}

export function emitRunDiffWithDeps(activeRuns: Map<string, AffordanceActiveRun>, writeLog: RunLogWriter, jobId: string, runId: string, dir?: string, commit?: string): RunAffordanceResult {
  const active = activeRuns.get(runId);
  if (!active || active.jobId !== jobId) return { ok: false, status: 409, error: "run is not active" };

  const run = findRun(jobId, runId);
  const cwd = run?.cwdSnapshot;
  if (!cwd) return { ok: false, status: 404, error: "run not found" };

  const resolved = resolveDiffCwd(dir, cwd);
  if (resolved.kind === "bad_dir") return { ok: false, status: 400, error: `\`${resolved.attempted}\` is not a directory.` };

  const result = computeBureauDiff(resolved.cwd, { commit });
  switch (result.kind) {
    case "not_repo":
      writeLog(active, "system", `\`${result.cwd}\` is not a git repository.`);
      break;
    case "git_error":
      writeLog(active, "system", `Failed to run git diff in \`${result.cwd}\`:\n\n\`\`\`\n${result.message}\n\`\`\``);
      break;
    case "bad_commit":
      writeLog(active, "system", `Cannot diff \`${result.attempted}\`: ${result.message}.`);
      break;
    case "clean":
      writeLog(active, "system", commit ? `\`${commit}\` introduced no file changes (empty commit?).` : `Working tree clean in \`${result.cwd}\` — no uncommitted changes.`);
      break;
    case "ok":
      writeLog(active, "diff", result.summary, undefined, undefined, { diff: result.payload });
      break;
  }
  return { ok: true };
}
