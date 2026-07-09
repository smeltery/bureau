import { homedir } from "os";
import { basename, resolve as resolvePath } from "path";
import { existsSync, readFileSync, statSync } from "fs";
import { computeBureauDiff, resolveDiffCwd } from "../bureau-diff.ts";
import { saveFile as savePersistedFile } from "../persistence.ts";
import { mimeTypeForFilename } from "../mime-types.ts";
import { openFile as openFileImpl, resolveEditorPath, saveFile as saveFileImpl, type OpenFileResult, type SaveFileResult } from "../file-editor.ts";
import { addLogEntry, agents, emitEphemeralLog } from "./state.ts";

const TERMINAL_COMMAND_MAX_LEN = 4096;
const EDIT_FILE_MAX_LEN = 4096;
const MAX_READ_FILE_BYTES = 20 * 1024 * 1024;

export function emitAgentTerminalCommand(agentId: string, rawCommand: string): { ok: true } | { ok: false; status: number; error: string } {
  const managed = agents.get(agentId);
  if (!managed) return { ok: false, status: 404, error: "agent not found" };
  if (typeof rawCommand !== "string") return { ok: false, status: 400, error: "command must be a string" };
  const command = rawCommand.replace(/\s+$/u, "");
  if (!command) return { ok: false, status: 400, error: "empty command" };
  if (command.length > TERMINAL_COMMAND_MAX_LEN) {
    return { ok: false, status: 400, error: `command too long (max ${TERMINAL_COMMAND_MAX_LEN} chars)` };
  }
  if (/[\r\n]/u.test(command)) {
    return { ok: false, status: 400, error: "command must be single-line; join steps with && or ;" };
  }
  addLogEntry(agentId, "terminal-command", command, undefined, undefined, { terminal: { command } });
  return { ok: true };
}

export function openEditorFile(agentId: string, rawPath: string): { ok: true; result: OpenFileResult } | { ok: false; error: "not_agent" | "bad_path" } {
  const managed = agents.get(agentId);
  if (!managed) return { ok: false, error: "not_agent" };
  const resolved = resolveEditorPath(rawPath, managed.info.cwd);
  if (resolved.kind === "bad_path") return { ok: false, error: "bad_path" };
  return { ok: true, result: openFileImpl(resolved.path) };
}

export function saveEditorFile(absPath: string, content: string, expectedMtime: number, force: boolean): SaveFileResult {
  return saveFileImpl(absPath, content, expectedMtime, force);
}

export function resolveEditorPathForAgent(agentId: string, rawPath: string): string | null {
  const managed = agents.get(agentId);
  if (!managed) return null;
  const resolved = resolveEditorPath(rawPath, managed.info.cwd);
  return resolved.kind === "ok" ? resolved.path : null;
}

export function emitAgentEditFile(agentId: string, rawPath: string): { ok: true } | { ok: false; status: number; error: string } {
  const managed = agents.get(agentId);
  if (!managed) return { ok: false, status: 404, error: "agent not found" };
  if (typeof rawPath !== "string") return { ok: false, status: 400, error: "path must be a string" };
  const trimmed = rawPath.trim();
  if (!trimmed) return { ok: false, status: 400, error: "empty path" };
  if (trimmed.length > EDIT_FILE_MAX_LEN) return { ok: false, status: 400, error: `path too long (max ${EDIT_FILE_MAX_LEN} chars)` };
  let resolved: string;
  if (trimmed.startsWith("~/")) resolved = resolvePath(homedir(), trimmed.slice(2));
  else if (trimmed === "~") resolved = homedir();
  else if (trimmed.startsWith("/")) resolved = resolvePath(trimmed);
  else resolved = resolvePath(managed.info.cwd, trimmed);
  addLogEntry(agentId, "edit-request", resolved, undefined, undefined, { file: { path: resolved } });
  return { ok: true };
}

export function emitAgentReadFile(agentId: string, rawPath: string): { ok: true } | { ok: false; status: number; error: string } {
  const managed = agents.get(agentId);
  if (!managed) return { ok: false, status: 404, error: "agent not found" };
  const resolved = resolveEditorPath(rawPath, managed.info.cwd);
  if (resolved.kind === "bad_path") {
    return { ok: false, status: 400, error: "missing or empty path" };
  }
  const absPath = resolved.path;
  if (!existsSync(absPath)) {
    addLogEntry(agentId, "system", `\`${absPath}\` does not exist.`);
    return { ok: true };
  }
  let st;
  try {
    st = statSync(absPath);
  } catch (err) {
    addLogEntry(agentId, "system", `Failed to read \`${absPath}\`: ${err instanceof Error ? err.message : String(err)}`);
    return { ok: true };
  }
  if (!st.isFile()) {
    addLogEntry(agentId, "system", `\`${absPath}\` is not a file.`);
    return { ok: true };
  }
  if (st.size > MAX_READ_FILE_BYTES) {
    addLogEntry(agentId, "system", `\`${absPath}\` is ${(st.size / (1024 * 1024)).toFixed(1)} MB — too large to display (${MAX_READ_FILE_BYTES / (1024 * 1024)} MB limit).`);
    return { ok: true };
  }
  let data: Buffer;
  try {
    data = readFileSync(absPath);
  } catch (err) {
    addLogEntry(agentId, "system", `Failed to read \`${absPath}\`: ${err instanceof Error ? err.message : String(err)}`);
    return { ok: true };
  }
  const originalName = basename(absPath);
  const mediaType = mimeTypeForFilename(originalName);
  const att = savePersistedFile(agentId, data, mediaType, originalName);
  if (!att) {
    addLogEntry(agentId, "system", `Failed to save \`${absPath}\` for display.`);
    return { ok: true };
  }
  addLogEntry(agentId, "file-view", originalName, undefined, [att]);
  return { ok: true };
}

export function emitAgentDiff(agentId: string, dir?: string, commit?: string): { ok: true } | { ok: false; status: number; error: string } {
  const managed = agents.get(agentId);
  if (!managed) return { ok: false, status: 404, error: "agent not found" };

  const resolved = resolveDiffCwd(dir, managed.info.cwd);
  if (resolved.kind === "bad_dir") {
    return { ok: false, status: 400, error: `\`${resolved.attempted}\` is not a directory.` };
  }

  const result = computeBureauDiff(resolved.cwd, { commit });
  switch (result.kind) {
    case "not_repo":
      emitEphemeralLog(agentId, "system", `\`${result.cwd}\` is not a git repository.`);
      break;
    case "git_error":
      emitEphemeralLog(agentId, "system", `Failed to run git diff in \`${result.cwd}\`:\n\n\`\`\`\n${result.message}\n\`\`\``);
      break;
    case "bad_commit":
      emitEphemeralLog(agentId, "system", `Cannot diff \`${result.attempted}\`: ${result.message}.`);
      break;
    case "clean":
      emitEphemeralLog(agentId, "system", commit ? `\`${commit}\` introduced no file changes (empty commit?).` : `Working tree clean in \`${result.cwd}\` — no uncommitted changes.`);
      break;
    case "ok":
      emitEphemeralLog(agentId, "diff", result.summary, undefined, { diff: result.payload });
      break;
  }
  return { ok: true };
}
