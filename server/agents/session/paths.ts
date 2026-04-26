import { join, resolve } from "path";
import { homedir } from "os";
import { existsSync, mkdirSync, renameSync, statSync } from "fs";
import { listAgentSessions } from "../../persistence.ts";

// Resolve ~ in paths
export function resolveCwd(cwd: string): string {
  if (cwd.startsWith("~/")) return resolve(homedir(), cwd.slice(2));
  if (cwd === "~") return homedir();
  return resolve(cwd);
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
export function claudeProjectDir(cwd: string): string {
  return join(homedir(), ".claude", "projects", cwd.replace(/[^a-zA-Z0-9-]/g, "-"));
}

export function claudeSessionFileExists(cwd: string, sessionId: string): boolean {
  return existsSync(join(claudeProjectDir(cwd), `${sessionId}.jsonl`));
}

// Move an agent's Claude CLI session files from one cwd's project dir to another.
// The Claude CLI derives its session storage path from cwd, so changing an agent's cwd
// without moving these files orphans every session on the next respawn (e.g. server restart).
export function moveClaudeSessionFiles(agentId: string, oldCwd: string, newCwd: string) {
  const oldDir = claudeProjectDir(oldCwd);
  const newDir = claudeProjectDir(newCwd);
  if (oldDir === newDir || !existsSync(oldDir)) return;
  const sessions = listAgentSessions(agentId);
  if (sessions.length === 0) return;
  mkdirSync(newDir, { recursive: true });
  for (const { sessionId } of sessions) {
    const oldJsonl = join(oldDir, `${sessionId}.jsonl`);
    const newJsonl = join(newDir, `${sessionId}.jsonl`);
    if (existsSync(oldJsonl) && !existsSync(newJsonl)) {
      try {
        renameSync(oldJsonl, newJsonl);
      } catch (err) {
        console.error(`[cwd-change] Failed to move ${oldJsonl} -> ${newJsonl}:`, err);
      }
    }
    // Claude CLI also writes a sibling <sessionId>/ dir (tool-results cache, etc.)
    const oldSib = join(oldDir, sessionId);
    const newSib = join(newDir, sessionId);
    if (existsSync(oldSib) && !existsSync(newSib)) {
      try {
        renameSync(oldSib, newSib);
      } catch (err) {
        console.error(`[cwd-change] Failed to move ${oldSib} -> ${newSib}:`, err);
      }
    }
  }
}
