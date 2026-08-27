import { join, resolve } from "path";
import { homedir } from "os";
import { closeSync, existsSync, mkdirSync, openSync, readSync, readdirSync, renameSync, statSync } from "fs";
import { errMessage } from "../../../shared/errors.ts";
import { BUREAU_CODEX_HOME } from "../../backends/codex/native-bin.ts";

// Resolve ~ in paths
export function resolveCwd(cwd: string): string {
  if (cwd.startsWith("~/")) return resolve(homedir(), cwd.slice(2));
  if (cwd === "~") return homedir();
  return resolve(cwd);
}

// Inverse of resolveCwd's home expansion: abbreviate the user's home dir prefix
// back to `~` for display (e.g. the resume picker, to save horizontal space).
// Only the exact home dir or a home-rooted path is abbreviated; unrelated paths
// pass through untouched. Display-only — never feed the result back into a path
// API without resolveCwd-ing it first.
export function tildifyCwd(cwd: string): string {
  const home = homedir();
  if (cwd === home) return "~";
  if (cwd.startsWith(home + "/")) return "~" + cwd.slice(home.length);
  return cwd;
}

// Resolve and verify a cwd. Throws if the directory does not exist or is not a directory.
export function validateCwd(cwd: string): string {
  const resolved = resolveCwd(cwd);
  let stat;
  try {
    stat = statSync(resolved);
  } catch (err: any) {
    if (err.code === "ENOENT") throw new Error(`Directory does not exist: ${resolved}`);
    throw new Error(`Cannot access ${resolved}: ${err.message}`);
  }
  if (!stat.isDirectory()) throw new Error(`Not a directory: ${resolved}`);
  return resolved;
}

// Directory where Claude CLI stores per-project session JSONLs.
// Sanitization observed: any non-alphanumeric, non-hyphen char becomes "-".
// Ex: /home/nil/nicholasadamou.com -> -home-nil-nicholasadamou-com
//
// Honors CLAUDE_CONFIG_DIR (the same env var the Claude SDK reads) so that
// office/room envFile setups pointing at a non-default config dir resolve to
// the same projects/ tree the spawned subprocess uses. Falls back to ~/.claude
// when env is unset or omitted — preserves today's behavior for default users.
export function claudeProjectDir(cwd: string, env?: { [key: string]: string | undefined }): string {
  const configDir = env?.CLAUDE_CONFIG_DIR || join(homedir(), ".claude");
  return join(configDir, "projects", cwd.replace(/[^a-zA-Z0-9-]/g, "-"));
}

export function claudeSessionFileExists(cwd: string, sessionId: string, env?: { [key: string]: string | undefined }): boolean {
  return existsSync(join(claudeProjectDir(cwd, env), `${sessionId}.jsonl`));
}

export function codexSessionsDir(env?: { [key: string]: string | undefined }): string {
  return join(env?.CODEX_HOME || BUREAU_CODEX_HOME, "sessions");
}

const CODEX_ROLLOUT_SCAN_DIR_CAP = 50_000;
const CODEX_ROLLOUT_HEADER_SCAN_LINES = 16;
const CODEX_THREAD_ID_PATTERN = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

export function codexRolloutFileExists(threadId: string, env?: { [key: string]: string | undefined }): boolean {
  return findCodexRolloutPath(threadId, env) !== null;
}

export function codexRolloutHasHistory(threadId: string, env?: { [key: string]: string | undefined }): boolean {
  const path = findCodexRolloutPath(threadId, env);
  if (path === null) return false;
  if (path === "") return true;
  return rolloutFileHasNonMetaLine(path);
}

function findCodexRolloutPath(threadId: string, env?: { [key: string]: string | undefined }): string | null {
  if (!CODEX_THREAD_ID_PATTERN.test(threadId)) return null;
  const sessionsDir = codexSessionsDir(env);
  if (!existsSync(sessionsDir)) return null;
  const filenameSuffix = `-${threadId}.jsonl`;
  let dirsVisited = 0;
  const stack = [sessionsDir];
  while (stack.length > 0) {
    if (dirsVisited >= CODEX_ROLLOUT_SCAN_DIR_CAP) return "";
    const dir = stack.pop()!;
    dirsVisited++;
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) stack.push(full);
      else if (entry.isFile() && entry.name.startsWith("rollout-") && entry.name.endsWith(filenameSuffix)) return full;
    }
  }
  return null;
}

function rolloutFileHasNonMetaLine(path: string): boolean {
  const HEAD_BYTES = 128 * 1024;
  let head: string;
  try {
    const fd = openSync(path, "r");
    try {
      const tmp = Buffer.alloc(HEAD_BYTES);
      const n = readSync(fd, tmp, 0, HEAD_BYTES, 0);
      head = tmp.subarray(0, n).toString("utf8");
    } finally {
      closeSync(fd);
    }
  } catch {
    return true;
  }
  const segments = head.split("\n");
  const trailingNewline = head.endsWith("\n");
  let scanned = 0;
  for (let i = 0; i < segments.length; i++) {
    const segment = segments[i];
    const isLast = i === segments.length - 1;
    if (isLast && trailingNewline && !segment.length) continue;
    if (scanned >= CODEX_ROLLOUT_HEADER_SCAN_LINES) return true;
    if (!segment.length) continue;
    scanned++;
    let parsed: { type?: unknown } | null = null;
    try {
      parsed = JSON.parse(segment) as { type?: unknown };
    } catch {
      if (isLast && !trailingNewline) return true;
      continue;
    }
    if (parsed && typeof parsed === "object" && parsed.type && parsed.type !== "session_meta") return true;
  }
  return false;
}

// Move a single Claude CLI session's files from one cwd's project dir to
// another. The Claude CLI derives its session storage path from cwd, so
// changing the cwd a session runs in without moving its files orphans it on the
// next respawn (e.g. server restart) — resume can't find it.
//
// Scoped to ONE session by design: under per-session cwd, an agent's other
// sessions keep their own recorded cwd and must stay where they are. (The
// previous move-all behavior matched the old agent-level cwd model, where every
// session implicitly shared the agent's single cwd.)
//
// `env` selects which CLAUDE_CONFIG_DIR projects/ tree to read from and write
// to. Callers must pass the env that corresponds to the agent's *current*
// room/office envFile state — if room ever changes in the same edit as cwd, the
// move must run with the OLD room's env, before the room mutation commits.
//
// Returns a structured result so the caller can keep session metadata honest:
//   - { ok: true, moved: false }  → nothing to move (no source, or same dir)
//   - { ok: true, moved: true }   → moved successfully
//   - { ok: false, moved, error } → source existed but a rename failed; `moved`
//     says whether a partial move happened (so the caller can reverse it). A
//     failed move must NOT be followed by stamping the session's new cwd —
//     Claude wouldn't find the .jsonl there.
export function moveClaudeSessionFile(sessionId: string, oldCwd: string, newCwd: string, env?: { [key: string]: string | undefined }): { ok: boolean; moved: boolean; error?: string } {
  const oldDir = claudeProjectDir(oldCwd, env);
  const newDir = claudeProjectDir(newCwd, env);
  if (oldDir === newDir || !existsSync(oldDir)) return { ok: true, moved: false };
  const oldJsonl = join(oldDir, `${sessionId}.jsonl`);
  const newJsonl = join(newDir, `${sessionId}.jsonl`);
  // Claude CLI also writes a sibling <sessionId>/ dir (tool-results cache, etc.)
  const oldSib = join(oldDir, sessionId);
  const newSib = join(newDir, sessionId);
  const moveJsonl = existsSync(oldJsonl) && !existsSync(newJsonl);
  const moveSib = existsSync(oldSib) && !existsSync(newSib);
  if (!moveJsonl && !moveSib) return { ok: true, moved: false };
  mkdirSync(newDir, { recursive: true });
  let moved = false;
  if (moveJsonl) {
    try {
      renameSync(oldJsonl, newJsonl);
      moved = true;
    } catch (err) {
      console.error(`[cwd-change] Failed to move ${oldJsonl} -> ${newJsonl}:`, err);
      return { ok: false, moved, error: errMessage(err) };
    }
  }
  if (moveSib) {
    try {
      renameSync(oldSib, newSib);
      moved = true;
    } catch (err) {
      console.error(`[cwd-change] Failed to move ${oldSib} -> ${newSib}:`, err);
      return { ok: false, moved, error: errMessage(err) };
    }
  }
  return { ok: true, moved };
}
