import { closeSync, existsSync, openSync, readFileSync, readSync, statSync, writeFileSync } from "fs";
import { extname, isAbsolute, join, resolve } from "path";
import { homedir } from "os";

export type ResolvePathResult = { kind: "ok"; path: string } | { kind: "bad_path"; attempted: string };

export type OpenFileResult =
  | { kind: "ok"; path: string; content: string; mtime: number; language: string; size: number; sig: string }
  | { kind: "not_found"; path: string }
  | { kind: "not_file"; path: string }
  | { kind: "binary"; path: string }
  | { kind: "too_large"; path: string; size: number }
  | { kind: "io_error"; path: string; message: string };

export type SaveFileResult =
  | { kind: "ok"; path: string; mtime: number }
  | { kind: "stale"; path: string; currentMtime: number }
  | { kind: "deleted"; path: string }
  | { kind: "io_error"; path: string; message: string };

const MAX_FILE_BYTES = 1_000_000;
const WATCH_POLL_MS = 1000;

function fileSig(st: { mtimeMs: number; ino: number | bigint; size: number }): string {
  return `${st.mtimeMs}:${st.ino}:${st.size}`;
}

// Resolve a user-supplied editor path against the agent's cwd. Yields an
// absolute path — existence/type checks happen later in openFile.
export function resolveEditorPath(rawPath: string | undefined, agentCwd: string): ResolvePathResult {
  const trimmed = rawPath?.trim();
  if (!trimmed) return { kind: "bad_path", attempted: trimmed ?? "" };
  const expanded = trimmed.startsWith("~") ? join(homedir(), trimmed.slice(1).replace(/^[/\\]/, "")) : trimmed;
  const abs = isAbsolute(expanded) ? expanded : resolve(agentCwd, expanded);
  return { kind: "ok", path: abs };
}

function detectLanguage(absPath: string): string {
  const ext = extname(absPath).toLowerCase();
  switch (ext) {
    case ".js":
    case ".jsx":
    case ".mjs":
    case ".cjs":
    case ".ts":
    case ".tsx":
      return "javascript";
    case ".json":
      return "json";
    case ".md":
    case ".markdown":
    case ".mdx":
      return "markdown";
    case ".css":
    case ".scss":
    case ".less":
      return "css";
    case ".html":
    case ".htm":
      return "html";
    case ".py":
      return "python";
    case ".rs":
      return "rust";
    case ".go":
      return "go";
    default:
      return "plaintext";
  }
}

// Probe the first 8 KB for null bytes — same heuristic as untracked-file
// binary detection in bureau-diff.ts.
function isBinary(absPath: string, size: number): boolean {
  let fd: number | null = null;
  try {
    fd = openSync(absPath, "r");
    const probeSize = Math.min(8192, size);
    const probe = Buffer.alloc(probeSize);
    const read = readSync(fd, probe, 0, probeSize, 0);
    for (let i = 0; i < read; i++) if (probe[i] === 0) return true;
    return false;
  } catch {
    return false;
  } finally {
    if (fd !== null)
      try {
        closeSync(fd);
      } catch {}
  }
}

export function openFile(absPath: string): OpenFileResult {
  if (!existsSync(absPath)) return { kind: "not_found", path: absPath };
  let st;
  try {
    st = statSync(absPath);
  } catch (err: any) {
    return { kind: "io_error", path: absPath, message: err?.message ?? String(err) };
  }
  if (!st.isFile()) return { kind: "not_file", path: absPath };
  if (st.size > MAX_FILE_BYTES) return { kind: "too_large", path: absPath, size: st.size };
  if (isBinary(absPath, st.size)) return { kind: "binary", path: absPath };
  let content: string;
  try {
    content = readFileSync(absPath, "utf8");
  } catch (err: any) {
    return { kind: "io_error", path: absPath, message: err?.message ?? String(err) };
  }
  return { kind: "ok", path: absPath, content, mtime: Math.floor(st.mtimeMs), language: detectLanguage(absPath), size: st.size, sig: fileSig(st) };
}

export function saveFile(absPath: string, content: string, expectedMtime: number, force: boolean): SaveFileResult {
  // Concurrency guard: if disk mtime is newer than what the client opened,
  // refuse unless `force`. The client surfaces a banner that lets the boss
  // pick Overwrite (force=true) or Reload.
  let currentMtime = 0;
  try {
    const st = statSync(absPath);
    currentMtime = Math.floor(st.mtimeMs);
  } catch (err: any) {
    if (err?.code !== "ENOENT") return { kind: "io_error", path: absPath, message: err?.message ?? String(err) };
    if (!force) return { kind: "deleted", path: absPath };
  }
  if (!force && currentMtime > expectedMtime) {
    return { kind: "stale", path: absPath, currentMtime };
  }
  try {
    writeFileSync(absPath, content, "utf8");
    const st = statSync(absPath);
    return { kind: "ok", path: absPath, mtime: Math.floor(st.mtimeMs) };
  } catch (err: any) {
    return { kind: "io_error", path: absPath, message: err?.message ?? String(err) };
  }
}

// Lightweight per-WS file watcher registry. Each WS owns a Map<key, Watcher>;
// on disconnect the caller iterates and closes them all. Independent buffers,
// last-save-wins across WSes.
export interface FileWatcher {
  agentId: string;
  path: string;
  timer: ReturnType<typeof setInterval>;
}

export type WatchFileEvent = { kind: "change"; mtime: number } | { kind: "deleted" };

const DELETE_CONFIRM_POLLS = 2;

export function watchFile(absPath: string, agentId: string, onEvent: (event: WatchFileEvent) => void, baselineSig?: string): FileWatcher {
  let lastSig =
    baselineSig ??
    (() => {
      try {
        return fileSig(statSync(absPath));
      } catch {
        return "";
      }
    })();
  let missingPolls = 0;
  const timer = setInterval(() => {
    try {
      const st = statSync(absPath);
      missingPolls = 0;
      const sig = fileSig(st);
      if (sig === lastSig) return;
      lastSig = sig;
      onEvent({ kind: "change", mtime: Math.floor(st.mtimeMs) });
    } catch (err: any) {
      if (err?.code !== "ENOENT") return;
      missingPolls += 1;
      if (missingPolls === DELETE_CONFIRM_POLLS) onEvent({ kind: "deleted" });
      // Keep polling so a re-created file still emits on the next successful
      // stat. The confirmation threshold avoids transient unlink/recreate
      // save styles showing as deletion.
      lastSig = "";
    }
  }, WATCH_POLL_MS);
  timer.unref?.();
  return { agentId, path: absPath, timer };
}

export function stopWatch(w: FileWatcher) {
  clearInterval(w.timer);
}
