import { homedir } from "os";
import { basename, join } from "path";
import { existsSync, readFileSync, rmSync, statSync } from "fs";
import type { AgentBackendType, AgentInfo, AgentOutfit, LogEntry, SkillInfo } from "../../shared/types.ts";
import { DEFAULT_AGENT_CAPABILITIES } from "../../shared/types.ts";
import { computeBureauDiff, resolveDiffCwd } from "../bureau-diff.ts";
import { listAgentSessions, loadAgents, loadLogWithAncestors, saveFile as savePersistedFile } from "../persistence.ts";
import { mimeTypeForFilename } from "../mime-types.ts";
import { autocompleteCommands } from "./commands.ts";
import { generateOutfit } from "./outfit.ts";
import { generateTopic, TOPIC_REGEN_THRESHOLD } from "./topic.ts";
import { addLogEntry, agents, emit, emitEphemeralLog, logCache, persistAll, rooms as roomList, setRooms, type ManagedAgent } from "./state.ts";
import { deduplicateSkills, discoverBundledSkills, discoverPluginSkills, discoverProjectSkills, discoverUserSkills } from "./skills-discovery.ts";
import { openFile as openFileImpl, saveFile as saveFileImpl, resolveEditorPath, type OpenFileResult, type SaveFileResult } from "../file-editor.ts";
import { moveClaudeSessionFiles, resolveCwd } from "./session/paths.ts";
import { buildSessionEnv, createSession, installSession, replaceSession } from "./session/runtime.ts";
import { getBackend } from "../backends/index.ts";
import { findRoomIndex, updateState } from "./state.ts";
import { sidecarSend } from "./terminal.ts";
import { BUREAU_DIR } from "../persistence/paths.ts";

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
  if (changes.cwd && changes.cwd !== managed.info.cwd) {
    const oldCwd = managed.info.cwd;
    // Build env BEFORE mutating cwd so the move targets the same
    // CLAUDE_CONFIG_DIR the spawn was using. Best-effort: if the office/room
    // envFile is broken, fall through to the default ~/.claude — losing the
    // move silently is worse than failing the cwd edit on a config error.
    let env: { [key: string]: string | undefined } | undefined;
    try {
      env = buildSessionEnv(managed);
    } catch {
      env = undefined;
    }
    managed.info.cwd = resolveCwd(changes.cwd);
    updated.cwd = managed.info.cwd;
    if (managed.info.agentType === "claude") moveClaudeSessionFiles(agentId, oldCwd, managed.info.cwd, env);
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

  // System prompt + cwd are passed into every createSession, so name/cwd/
  // customInstructions changes automatically apply to the next conversation.

  // Recreate session if model or permission mode changed so it takes effect immediately
  if (updated.modelFamily || updated.permissionMode || updated.codexSandbox || updated.effort) {
    const sessionId = managed.sessionId;
    const newSession = sessionId ? createSession(managed, sessionId) : createSession(managed);
    await replaceSession(agentId, managed, newSession);
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
