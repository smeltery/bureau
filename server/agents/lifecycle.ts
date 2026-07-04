import { homedir } from "os";
import { basename, join } from "path";
import { existsSync, readFileSync, rmSync, statSync } from "fs";
import type { AgentBackendType, AgentInfo, AgentOutfit, KilledAgentSummary, LogEntry, SkillInfo } from "../../shared/types.ts";
import { DEFAULT_AGENT_CAPABILITIES, KILLED_AGENT_CHIP_CAP } from "../../shared/types.ts";
import { computeBureauDiff, resolveDiffCwd } from "../bureau-diff.ts";
import {
  listAgentSessions,
  loadAgents,
  loadAgentHistory,
  loadLogWithAncestors,
  saveAgentHistory,
  saveFile as savePersistedFile,
  getSessionCwd,
  persistSessionCwd,
  type AgentHistoryEntry,
} from "../persistence.ts";
import { mimeTypeForFilename } from "../mime-types.ts";
import { autocompleteCommands } from "./commands.ts";
import { generateOutfit } from "./outfit.ts";
import { generateTopic, TOPIC_REGEN_THRESHOLD } from "./topic.ts";
import { addLogEntry, agents, emit, emitEphemeralLog, logCache, persistAll, rooms as roomList, setRooms, type ManagedAgent } from "./state.ts";
import { deduplicateSkills, discoverBundledSkills, discoverPluginSkills, discoverProjectSkills, discoverUserSkills } from "./skills-discovery.ts";
import { openFile as openFileImpl, saveFile as saveFileImpl, resolveEditorPath, type OpenFileResult, type SaveFileResult } from "../file-editor.ts";
import { moveClaudeSessionFile, resolveCwd, validateCwd } from "./session/paths.ts";
import { buildSessionEnv, createSession, installSession, replaceSession } from "./session/runtime.ts";
import { getBackend } from "../backends/index.ts";
import { findRoomIndex, updateState } from "./state.ts";
import { sidecarSend } from "./terminal.ts";
import { BUREAU_DIR, LOGS_DIR } from "../persistence/paths.ts";

// ---------------------------------------------------------------------------
// Public read-only getters used by server/index.ts
// ---------------------------------------------------------------------------

export function getAgent(agentId: string): AgentInfo | undefined {
  return agents.get(agentId)?.info;
}

// Resolve an agent's display identity (name + room) for prefixing
// agent-to-agent messages. Returns null if the agent isn't known.
// Looking it up server-side from the senderAgentId (rather than trusting
// a client-supplied name) prevents spoofing and stops a malicious caller
// from injecting prefix-delimiter characters into the prompt the
// receiver sees.
export function getAgentDisplay(agentId: string): { name: string; roomName: string } | null {
  const managed = agents.get(agentId);
  if (!managed) return null;
  const room = roomList[managed.info.room];
  return { name: managed.info.name, roomName: room?.name ?? `Room ${managed.info.room + 1}` };
}

export function getAllAgents(): AgentInfo[] {
  return [...agents.values()].map((a) => a.info);
}

// Get cached logs for an agent (used when browser connects after restore)
export function getAgentLogs(agentId: string): LogEntry[] {
  return logCache.get(agentId) ?? [];
}

export function getAgentCommands(agentId: string): { commands: { name: string; description?: string }[]; skills: SkillInfo[] } {
  const managed = agents.get(agentId);
  return {
    commands: managed?.slashCommands ?? [],
    skills: managed?.skills ?? [],
  };
}

export function listSessions(agentId: string) {
  return listAgentSessions(agentId);
}

export function getCurrentSessionId(agentId: string): string | null {
  return agents.get(agentId)?.sessionId ?? null;
}

// Validate a shell command and emit a `terminal-command` log entry so the
// boss sees a [Copy to terminal] card in chat. Single-line only; agents
// that need multiple steps can join with `&&` / `;`. The card does not
// auto-execute — clicking it opens the terminal panel and types the
// command at the prompt, leaving the boss to review and press Enter.
const TERMINAL_COMMAND_MAX_LEN = 4096;
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

// Resolve a user-supplied editor path against the named agent's cwd and
// open it. Returns either the file payload or a structured error so the WS
// handler can render the right diagnostic.
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

// Validate a file path and emit an `edit-request` log entry so the boss
// sees an [Open in editor] card in chat. Clicking the card opens the file
// in the editor side panel.
import { resolve as resolvePath } from "path";
const EDIT_FILE_MAX_LEN = 4096;
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

// Display cap for POST /agents/:id/read-file. Independent from the editor
// panel's text cap — this one bounds binary/image display payloads served
// through /api/files.
const MAX_READ_FILE_BYTES = 20 * 1024 * 1024;

// Resolve a path against the agent's cwd, copy it into the agent's files
// dir (hash-deduped via saveFile), and emit a `file-view` log entry so the
// UI renders the attachment inline (images) or as a clickable chip
// (everything else). Mirrors emitAgentEditFile's error-surface pattern:
// path/size/io failures become system messages, not HTTP errors.
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

// Emit a styled diff card into an agent's chat. Mirrors the /bureau-diff slash
// command but driven by HTTP — agents call POST /agents/:id/diff to surface a
// diff when the boss asks for their changes in plain English.
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

// ---------------------------------------------------------------------------
// editAgent — mutate name/cwd/outfit/customInstructions/model/permission mode
// ---------------------------------------------------------------------------

export async function editAgent(
  agentId: string,
  changes: {
    name?: string;
    cwd?: string;
    outfit?: AgentInfo["outfit"];
    customInstructions?: string;
    modelFamily?: string;
    permissionMode?: AgentInfo["permissionMode"];
    codexSandbox?: AgentInfo["codexSandbox"];
    effort?: AgentInfo["effort"];
  },
) {
  const managed = agents.get(agentId);
  if (!managed) return;

  const updated: Partial<AgentInfo> = {};

  if (changes.name && changes.name !== managed.info.name) {
    // Reject duplicate names
    const nameLower = changes.name.trim().toLowerCase();
    const duplicate = [...agents.values()].some((a) => a.info.id !== agentId && a.info.name.toLowerCase() === nameLower);
    if (!duplicate) {
      managed.info.name = changes.name;
      updated.name = changes.name;
    }
  }
  // cwd is a property of the session: changing it retargets the agent's active
  // session. The live backend process's cwd is fixed at spawn, so the actual
  // work — the Claude file move, the Codex thread drop, the stored-cwd stamp —
  // is deferred into the replace block below (which always runs for a cwd
  // change) so it can resume the relocated session in one step. Here we only
  // capture the pre-mutation cwd + env and switch the mirror. Build env BEFORE
  // mutating cwd so the move targets the CLAUDE_CONFIG_DIR the spawn was using;
  // best-effort, since a broken envFile shouldn't block the edit on a config error.
  let cwdChanging = false;
  let oldCwd = managed.info.cwd;
  let cwdMoveEnv: { [key: string]: string | undefined } | undefined;
  if (changes.cwd) {
    const resolvedNew = resolveCwd(changes.cwd);
    if (resolvedNew !== managed.info.cwd) {
      cwdChanging = true;
      oldCwd = managed.info.cwd;
      try {
        cwdMoveEnv = buildSessionEnv(managed);
      } catch {
        cwdMoveEnv = undefined;
      }
      managed.info.cwd = resolvedNew;
      updated.cwd = resolvedNew;
    }
  }
  if (changes.outfit) {
    managed.info.outfit = changes.outfit;
    updated.outfit = changes.outfit;
  }
  if (changes.customInstructions !== undefined && changes.customInstructions !== managed.info.customInstructions) {
    managed.info.customInstructions = changes.customInstructions || null;
    updated.customInstructions = managed.info.customInstructions;
  }
  if (changes.modelFamily && changes.modelFamily !== managed.info.modelFamily) {
    managed.info.modelFamily = changes.modelFamily;
    updated.modelFamily = changes.modelFamily;
  }
  if (changes.permissionMode && changes.permissionMode !== managed.info.permissionMode) {
    managed.info.permissionMode = changes.permissionMode;
    updated.permissionMode = changes.permissionMode;
  }
  if (changes.codexSandbox && changes.codexSandbox !== managed.info.codexSandbox) {
    managed.info.codexSandbox = changes.codexSandbox;
    updated.codexSandbox = changes.codexSandbox;
  }
  if (changes.effort && changes.effort !== managed.info.effort) {
    managed.info.effort = changes.effort;
    updated.effort = changes.effort;
  }

  if (Object.keys(updated).length === 0) return;

  // System prompt is passed into every createSession, so name/customInstructions
  // changes automatically apply to the next conversation.

  const isClaude = managed.info.agentType === "claude";
  const settingsReplace = !!(updated.modelFamily || updated.permissionMode || updated.codexSandbox || updated.effort);
  // A cwd change retargets the active session — the live backend process's cwd
  // is fixed at spawn, so it must be replaced. Settings changes (model /
  // permission / sandbox / effort) replace regardless so they take effect now.
  const needReplace = settingsReplace || cwdChanging;

  if (needReplace) {
    const codexCwdChange = cwdChanging && !isClaude;

    // Claude cwd change: relocate the active session's files to the new project
    // dir BEFORE the resume so createSession finds them there. A failed move
    // means Claude can't locate the .jsonl, so abort the cwd change (roll the
    // mirror back, reverse any partial move) rather than stamp the session into
    // a cwd it can't be resumed from.
    if (cwdChanging && isClaude && managed.sessionId) {
      const target = managed.info.cwd;
      const moved = moveClaudeSessionFile(managed.sessionId, oldCwd, target, cwdMoveEnv);
      if (!moved.ok) {
        managed.info.cwd = oldCwd;
        delete updated.cwd;
        let reversed = true;
        if (moved.moved) reversed = moveClaudeSessionFile(managed.sessionId, target, oldCwd, cwdMoveEnv).ok;
        throw new Error(
          `Failed to move session files to ${target}: ${moved.error}. ` +
            (reversed
              ? `cwd change aborted; the session stays in ${oldCwd}.`
              : `cwd change aborted, but the session files could not be moved back and now live in ${target}; resume may fail until they are restored.`),
        );
      }
    }

    // Codex can't carry a cwd across a resume (thread/resume ignores cwd), so a
    // cwd change abandons the thread and starts a fresh one in the new cwd. Wipe
    // the prior conversation (mirrors newConversation) so the fresh thread
    // doesn't inherit stale log history bound to the old cwd. The old thread's
    // rollout stays on disk, resumable via /resume.
    if (codexCwdChange) {
      managed.sessionId = null;
      logCache.set(agentId, []);
      emit({ type: "clear_logs", agentId } as any);
      managed.topicMessageCount = 0;
      managed.info.topic = null;
      managed.info.topicStale = false;
      updated.topic = null;
      updated.topicStale = false;
    }

    const resumeId = managed.sessionId;
    const newSession = resumeId ? createSession(managed, resumeId) : createSession(managed);
    await replaceSession(agentId, managed, newSession);

    // Stamp the active Claude session's new cwd as source of truth. Fresh
    // sessions (the Codex cwd change, or a from-scratch session) get stamped by
    // system_init's ensureSessionCwd instead.
    if (cwdChanging && isClaude && managed.sessionId) {
      persistSessionCwd(agentId, managed.sessionId, managed.info.cwd);
    }
  }

  persistAll();
  emit({ type: "agent_updated", agentId, changes: updated });
}

// ---------------------------------------------------------------------------
// spawn — create a new agent
// ---------------------------------------------------------------------------

export async function spawn(
  name: string,
  cwd: string,
  permissionMode: AgentInfo["permissionMode"],
  desk?: number,
  customInstructions?: string,
  roomId?: string,
  outfit?: AgentOutfit,
  modelFamily?: string,
  agentType: AgentBackendType = "claude",
  codexSandbox?: AgentInfo["codexSandbox"],
  effort?: AgentInfo["effort"],
  userId?: string | null,
): Promise<AgentInfo | null> {
  // Reject duplicate names across all rooms
  const nameLower = name.trim().toLowerCase();
  for (const a of agents.values()) {
    if (a.info.name.toLowerCase() === nameLower) return null;
  }
  let targetRoom = 0;
  if (roomId) {
    const idx = findRoomIndex(roomId);
    if (idx >= 0) targetRoom = idx;
  }
  const roomAgents = [...agents.values()].filter((a) => a.info.room === targetRoom);
  const taken = new Set(roomAgents.map((a) => a.info.desk));
  if (desk !== undefined && !taken.has(desk)) {
    // Use the requested desk
  } else {
    // Find first free desk in the target room
    desk = -1;
    for (let i = 0; i < 8; i++) {
      if (!taken.has(i)) {
        desk = i;
        break;
      }
    }
  }
  if (desk === -1) return null;

  const resolvedCwd = resolveCwd(cwd);
  const id = `agent-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

  const info: AgentInfo = {
    id,
    name,
    userId: userId ?? null,
    desk,
    room: targetRoom,
    cwd: resolvedCwd,
    outfit: outfit ?? generateOutfit(),
    permissionMode,
    modelFamily: modelFamily ?? "opus",
    agentType,
    capabilities: getBackend(agentType).capabilities ?? DEFAULT_AGENT_CAPABILITIES,
    ...(codexSandbox ? { codexSandbox } : {}),
    ...(effort ? { effort } : {}),
    state: "idle",
    topic: null,
    topicStale: false,
    customInstructions: customInstructions || null,
    queue: [],
  };

  const managed: ManagedAgent = {
    info,
    session: null,
    sessionId: null,
    consumerPromise: null,
    pendingTurn: null,
    afterTurnPromise: null,
    turnCancelToken: 0,
    aborting: false,
    abortPromise: null,
    slashCommands: autocompleteCommands(),
    skills: deduplicateSkills([...discoverUserSkills(), ...discoverProjectSkills(resolvedCwd), ...discoverPluginSkills(), ...discoverBundledSkills()]),
    sdkReportedCommands: [],
    thinkingStartedAt: 0,
    toolCallTimestamps: new Map(),
    topicGenerating: false,
    topicMessageCount: 0,
    pendingResume: false,
    pendingResumeSessions: [],
    pendingModelPick: false,
    pendingEffortPick: false,
    pendingPermission: null,
    ptySidecar: null,
    ptyBuffer: "",
    messageQueue: [],
    flushInProgress: false,
    lastWrittenEntryId: null,
  };
  agents.set(id, managed);
  emit({ type: "agent_added", agent: info });
  // Send commands immediately so autocomplete works before SDK init
  emit({
    type: "slash_commands",
    agentId: id,
    commands: managed.slashCommands,
    skills: managed.skills,
  } as any);
  persistAll();

  // Create V2 session
  try {
    installSession(id, managed, createSession(managed));
    addLogEntry(id, "system", `${agentType === "codex" ? "Codex" : "Claude"} agent "${name}" ready. Working in ${resolvedCwd}. Permission mode: ${permissionMode}.`);
    // First stream() will deliver system/init + response to the first send().
  } catch (err: any) {
    console.error(`Failed to create session for ${name}:`, err.message);
    addLogEntry(id, "error", `Failed to start: ${err.message}`);
    updateState(id, "error");
  }

  return info;
}

// ---------------------------------------------------------------------------
// kill — tear down an agent
// ---------------------------------------------------------------------------

export async function kill(agentId: string) {
  const managed = agents.get(agentId);
  if (!managed) return;
  // Stamp the history entry with killedAt + a full config snapshot BEFORE
  // removing the agent from the live map. After deletion, updateAgentHistory
  // (run by persistAll below) skips this entry — its loop iterates live
  // agents only — so this write is the authoritative kill-time snapshot the
  // revive chip rehydrates from.
  const killedSummary = buildKilledAgentSummary(agentId, managed);
  {
    const room = roomList[managed.info.room];
    if (room) {
      const history = loadAgentHistory();
      history[agentId] = {
        name: managed.info.name,
        lastRoomId: room.id,
        lastRoomName: room.name,
        killedAt: Date.now(),
        cwd: managed.info.cwd,
        outfit: managed.info.outfit,
        permissionMode: managed.info.permissionMode,
        modelFamily: managed.info.modelFamily,
        effort: managed.info.effort,
        agentType: managed.info.agentType,
        codexSandbox: managed.info.codexSandbox,
        lastSessionId: managed.sessionId,
        topic: managed.info.topic,
        customInstructions: managed.info.customInstructions,
      };
      saveAgentHistory(history);
    }
  }
  // Bump the cancel token so any concurrent runAgentTurn that hasn't yet
  // installed pendingTurn (pre-send plugin retrieval) bails on its next
  // await checkpoint instead of calling session.send on a dying session.
  managed.turnCancelToken++;
  if (managed.pendingPermission) {
    managed.pendingPermission = null;
  }
  const turn = managed.pendingTurn;
  managed.pendingTurn = null;
  if (turn) {
    try {
      turn.reject(new Error("Agent killed."));
    } catch {}
  }
  const oldConsumer = managed.consumerPromise;
  try {
    managed.session?.close();
  } catch {}
  managed.session = null;
  // Remove from the map so the consumer's outer `agents.has(agentId)` guard exits.
  agents.delete(agentId);
  logCache.delete(agentId);
  if (oldConsumer) {
    try {
      await oldConsumer;
    } catch {}
  }
  try {
    sidecarSend(managed, { type: "kill" });
    managed.ptySidecar?.kill();
  } catch {}
  emit({ type: "agent_removed", agentId });
  persistAll();
  if (killedSummary) {
    emit({ type: "killed_agent_added", agent: killedSummary });
  }
}

// ---------------------------------------------------------------------------
// Killed-agent chip helpers + revive
// ---------------------------------------------------------------------------

// Wire-summary chip payload for a live agent at kill time. Returns null if the
// agent's room no longer exists (no provenance to ACL-filter against).
function buildKilledAgentSummary(agentId: string, a: ManagedAgent): KilledAgentSummary | null {
  const room = roomList[a.info.room];
  if (!room) return null;
  return {
    id: agentId,
    name: a.info.name,
    agentType: a.info.agentType,
    lastRoomId: room.id,
    lastRoomName: room.name,
    topic: a.info.topic,
    killedAt: Date.now(),
  };
}

// Wire-summary chip payload from a history entry. Legacy pre-revive entries
// (only name + lastRoom*, no killedAt) surface as Claude chips with their
// log-dir mtime as a proxy for the kill time — revive() defaults the missing
// config fields and tries to surface the on-disk transcript.
function killedAgentSummaryFromHistory(agentId: string, entry: AgentHistoryEntry, fallbackKilledAt: number): KilledAgentSummary {
  return {
    id: agentId,
    name: entry.name,
    agentType: entry.agentType ?? "claude",
    lastRoomId: entry.lastRoomId,
    lastRoomName: entry.lastRoomName,
    topic: entry.topic ?? null,
    killedAt: entry.killedAt ?? fallbackKilledAt,
  };
}

// For legacy entries (no kill-time stamp), use the agent's log directory mtime
// as a "last-touched" proxy so they sort approximately by recency. One stat
// call per legacy entry; fine for the scale this file reaches in practice.
function legacyKilledAtFromDisk(agentId: string): number {
  try {
    return statSync(join(LOGS_DIR, agentId)).mtimeMs;
  } catch {
    return 0;
  }
}

// All currently-killed agents, sorted newest-first. The caller layers ACL
// filtering and the cap. Revived agents have a history entry but are alive, so
// they're skipped. Legacy entries with no killedAt AND no on-disk log dir are
// dropped — there's nothing to revive and no ordering signal.
export function getKilledAgentSummaries(): KilledAgentSummary[] {
  const history = loadAgentHistory();
  const summaries: KilledAgentSummary[] = [];
  for (const [id, entry] of Object.entries(history)) {
    if (agents.has(id)) continue;
    const fallback = entry.killedAt ? 0 : legacyKilledAtFromDisk(id);
    if (!entry.killedAt && !fallback) continue;
    summaries.push(killedAgentSummaryFromHistory(id, entry, fallback));
  }
  summaries.sort((a, b) => b.killedAt - a.killedAt);
  return summaries;
}

// Revive a previously-killed agent. Same id / outfit / config, rehydrated from
// agent-history. The caller picks placement (target room + desk); the original
// lastRoomId is used only as an ACL provenance check. On session-startup
// failure the install is rolled back so the killed-agent chip stays available
// for retry.
export async function revive(agentId: string, roomId: string, desk: number): Promise<{ ok: true; agent: AgentInfo } | { ok: false; error: string; field?: "name" | "desk" | "room" }> {
  // 1. Must be currently killed (not in the live map).
  if (agents.has(agentId)) {
    return { ok: false, error: "That agent is already alive." };
  }
  const history = loadAgentHistory();
  const entry = history[agentId];
  if (!entry) {
    return { ok: false, error: "Killed agent not found in history." };
  }

  // 2. Original room must still exist (don't re-key a private-room agent into
  // an unrelated room).
  if (!roomList.some((r) => r.id === entry.lastRoomId)) {
    return { ok: false, error: "Agent's original room no longer exists." };
  }

  // 3. Target room must exist (the ws handler ACL-gates the room id).
  const roomIdx = findRoomIndex(roomId);
  if (roomIdx < 0) {
    return { ok: false, error: "Target room not found.", field: "room" };
  }

  // 4. Desk free at command time (the chip list may be stale across tabs).
  const taken = new Set([...agents.values()].filter((a) => a.info.room === roomIdx).map((a) => a.info.desk));
  if (desk < 0 || desk >= 8 || taken.has(desk)) {
    return { ok: false, error: "That desk is no longer free.", field: "desk" };
  }

  // 5. Name collision against LIVE agents only (history keeps dead names).
  const nameLower = entry.name.trim().toLowerCase();
  if ([...agents.values()].some((a) => a.info.name.toLowerCase() === nameLower)) {
    return { ok: false, error: `Name "${entry.name}" is already taken.`, field: "name" };
  }

  // 6. Resolve cwd; fall back to home if the saved path is gone or missing
  // entirely (legacy entries).
  let resolvedCwd: string = entry.cwd ?? homedir();
  try {
    resolvedCwd = validateCwd(resolvedCwd);
  } catch {
    console.warn(`[revive] cwd "${resolvedCwd}" for ${entry.name} is invalid; falling back to ~`);
    resolvedCwd = homedir();
  }

  // 7. Pick a resume session. Prefer the kill-time lastSessionId; for legacy
  // entries (no stamp), use the most recent .jsonl on disk so the historical
  // transcript can be surfaced. createSession's resume falls back to a fresh
  // session if the SDK can't actually resume that id.
  let resumeFromSession: string | null = entry.lastSessionId ?? null;
  if (!resumeFromSession) {
    resumeFromSession = listAgentSessions(agentId)[0]?.sessionId ?? null;
  }

  // cwd is a property of the session: if the resumed session recorded its own
  // cwd, prefer it over the killed-agent history snapshot (resolved above) so
  // the agent revives in the directory that session actually ran in. Keep the
  // snapshot fallback when the stored cwd is gone/invalid.
  if (resumeFromSession) {
    const sessionCwd = getSessionCwd(agentId, resumeFromSession);
    if (sessionCwd) {
      try {
        resolvedCwd = validateCwd(sessionCwd);
      } catch {
        // Stored session cwd unavailable — keep the step-6 fallback.
      }
    }
  }

  const agentType: AgentBackendType = entry.agentType ?? "claude";
  const info: AgentInfo = {
    id: agentId,
    name: entry.name,
    desk,
    room: roomIdx,
    cwd: resolvedCwd,
    outfit: entry.outfit ?? generateOutfit(),
    permissionMode: entry.permissionMode ?? "default",
    modelFamily: entry.modelFamily ?? "opus",
    agentType,
    capabilities: getBackend(agentType).capabilities ?? DEFAULT_AGENT_CAPABILITIES,
    ...(entry.codexSandbox ? { codexSandbox: entry.codexSandbox } : {}),
    ...(entry.effort ? { effort: entry.effort } : {}),
    state: resumeFromSession ? "waiting_for_response" : "idle",
    topic: entry.topic ?? null,
    topicStale: false,
    customInstructions: entry.customInstructions ?? null,
    queue: [],
  };

  const persistedTopicCount = resumeFromSession ? (listAgentSessions(agentId).find((s) => s.sessionId === resumeFromSession)?.topicMessageCount ?? 0) : 0;
  const managed: ManagedAgent = {
    info,
    session: null,
    sessionId: resumeFromSession,
    consumerPromise: null,
    pendingTurn: null,
    afterTurnPromise: null,
    turnCancelToken: 0,
    aborting: false,
    abortPromise: null,
    slashCommands: autocompleteCommands(),
    skills: deduplicateSkills([...discoverUserSkills(), ...discoverProjectSkills(resolvedCwd), ...discoverPluginSkills(), ...discoverBundledSkills()]),
    sdkReportedCommands: [],
    thinkingStartedAt: 0,
    toolCallTimestamps: new Map(),
    topicGenerating: false,
    topicMessageCount: persistedTopicCount,
    pendingResume: false,
    pendingResumeSessions: [],
    pendingModelPick: false,
    pendingEffortPick: false,
    pendingPermission: null,
    ptySidecar: null,
    ptyBuffer: "",
    messageQueue: [],
    flushInProgress: false,
    lastWrittenEntryId: null,
  };
  agents.set(agentId, managed);

  // Load log history into cache so the historical conversation stays visible
  // even when the SDK can't resume the old session (fresh-session fallback).
  if (resumeFromSession) {
    const logs = loadLogWithAncestors(agentId, resumeFromSession);
    if (logs.length > 0) {
      logCache.set(agentId, [...logs]);
      if (info.topic) {
        const textCount = logs.filter((e) => e.kind === "user_message" || e.kind === "text").length;
        if (textCount - persistedTopicCount > 0) info.topicStale = true;
      }
    }
  }

  // Bring the SDK session up. On failure, roll the install back so the chip
  // stays retryable — but keep any loaded transcript so the boss can still
  // read the historical conversation.
  try {
    const session = resumeFromSession ? createSession(managed, resumeFromSession) : createSession(managed);
    installSession(agentId, managed, session);
  } catch (err: any) {
    agents.delete(agentId);
    logCache.delete(agentId);
    return { ok: false, error: `Failed to revive: ${err?.message ?? String(err)}` };
  }

  // The history entry now describes a live agent again: clear killedAt so it
  // stops surfacing as a chip (updateAgentHistory in persistAll re-stamps the
  // live snapshot with killedAt: null).
  emit({ type: "agent_added", agent: info });
  emit({ type: "slash_commands", agentId, commands: managed.slashCommands, skills: managed.skills } as any);
  addLogEntry(agentId, "system", `Revived ${agentType === "codex" ? "Codex" : "Claude"} agent "${info.name}" at ${resolvedCwd}.`);
  persistAll();
  emit({ type: "killed_agent_removed", agentId, lastRoomId: entry.lastRoomId });
  return { ok: true, agent: info };
}

// ---------------------------------------------------------------------------
// restoreAgents — hydrate agents from disk on server startup
// ---------------------------------------------------------------------------

export async function restoreAgents(): Promise<AgentInfo[]> {
  // Clean up the pre-0.2.116 per-agent launcher scripts. Bureau now passes the
  // native Claude binary directly, so these are orphaned.
  try {
    rmSync(join(BUREAU_DIR, "launchers"), { recursive: true, force: true });
  } catch {}

  const loaded = loadAgents();
  setRooms(loaded.map((r) => ({ id: r.id, name: r.name, prompt: r.prompt, envFile: r.envFile })));

  for (let roomIdx = 0; roomIdx < loaded.length; roomIdx++) {
    for (const p of loaded[roomIdx].agents) {
      // Look up the persisted topicMessageCount baseline for the session
      // we're about to resume. Combined with a textCount scan of the loaded
      // history below, this lets us decide whether the persisted topic has
      // drifted since the topic was last generated.
      const persistedTopicCount = p.lastSessionId ? (listAgentSessions(p.id).find((s) => s.sessionId === p.lastSessionId)?.topicMessageCount ?? 0) : 0;
      const info: AgentInfo = {
        id: p.id,
        name: p.name,
        desk: p.desk,
        room: roomIdx,
        cwd: p.cwd,
        outfit: p.outfit,
        permissionMode: p.permissionMode,
        modelFamily: p.modelFamily ?? "opus",
        agentType: p.agentType ?? "claude",
        capabilities: getBackend(p.agentType ?? "claude").capabilities ?? DEFAULT_AGENT_CAPABILITIES,
        ...(p.codexSandbox ? { codexSandbox: p.codexSandbox } : {}),
        ...(p.effort ? { effort: p.effort } : {}),
        state: p.lastSessionId ? "waiting_for_response" : "idle",
        topic: p.topic ?? null,
        // Stale-on-load is determined by the textCount scan below (after
        // logs are loaded into the cache). Default to false here so a clean
        // restart doesn't flash the ↻ button on agents whose topic is
        // actually current.
        topicStale: false,
        customInstructions: p.customInstructions ?? null,
        queue: [],
      };
      const managed: ManagedAgent = {
        info,
        session: null,
        sessionId: p.lastSessionId,
        consumerPromise: null,
        pendingTurn: null,
        afterTurnPromise: null,
        turnCancelToken: 0,
        aborting: false,
        abortPromise: null,
        slashCommands: autocompleteCommands(),
        skills: deduplicateSkills([...discoverUserSkills(), ...discoverProjectSkills(p.cwd), ...discoverPluginSkills(), ...discoverBundledSkills()]),
        sdkReportedCommands: [],
        thinkingStartedAt: 0,
        toolCallTimestamps: new Map(),
        topicGenerating: false,
        topicMessageCount: persistedTopicCount,
        pendingResume: false,
        pendingResumeSessions: [],
        pendingModelPick: false,
        pendingEffortPick: false,
        pendingPermission: null,
        ptySidecar: null,
        ptyBuffer: "",
        messageQueue: [],
        flushInProgress: false,
        lastWrittenEntryId: null,
      };
      agents.set(p.id, managed);

      // Load log history into cache (browsers connect later, so we cache it).
      // Uses loadLogWithAncestors to include parent entries for forked sessions.
      if (p.lastSessionId) {
        const history = loadLogWithAncestors(p.id, p.lastSessionId);
        if (history.length > 0) {
          logCache.set(p.id, [...history]);
        }
        // Detect topic drift against the persisted baseline: if the
        // replayed history has grown past where the topic was last
        // generated, flag stale (lights up the ↻ button) and, if past the
        // refresh threshold, regenerate now so the agent's nametag is
        // honest the moment the user looks at it. fire-and-forget — the
        // call only needs logCache, which is populated above.
        if (info.topic) {
          const textCount = history.filter((e) => e.kind === "user_message" || e.kind === "text").length;
          const drift = textCount - persistedTopicCount;
          if (drift > 0) {
            // Mutate directly: no clients are listening yet (broadcast comes later).
            info.topicStale = true;
          }
          if (drift >= TOPIC_REGEN_THRESHOLD) {
            void generateTopic(p.id);
          }
        }
      }

      // If the prior session died owing a response (e.g. server restart
      // while mid-stream), drop a breadcrumb before auto-resume. Mirrors
      // the SDK's lazy synthetic placeholder injected into its own
      // transcript at the same moment so the user-visible log doesn't
      // diverge from the model's context.
      if (p.lastSessionId) {
        const tail = (logCache.get(p.id) ?? []).at(-1);
        if (tail?.kind === "user_message") {
          addLogEntry(p.id, "system", "Previous response was interrupted.");
        }
      }

      // Auto-resume session
      try {
        const session = p.lastSessionId ? createSession(managed, p.lastSessionId) : createSession(managed);
        installSession(p.id, managed, session);
      } catch (err: any) {
        console.error(`Failed to restore session for ${p.name}:`, err.message);
        managed.info.state = "error";
        // Surface to the UI so the user sees why the agent can't respond.
        const entry: LogEntry = {
          id: `log-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          agentId: p.id,
          timestamp: Date.now(),
          kind: "error",
          content: `Failed to restore on startup: ${err.message}\nType /clear to start fresh, or /resume to pick another session.`,
        };
        const cached = logCache.get(p.id) ?? [];
        cached.push(entry);
        logCache.set(p.id, cached);
      }
    }
  }
  // Round-trip migrations back to disk in case the load step filled in new
  // fields (room ids, prompt/envFile defaults) that weren't present before.
  // Must run AFTER agents are populated or persistAll writes empty rooms.
  persistAll();
  return [...agents.values()].map((a) => a.info);
}
