import { homedir } from "os";
import { join } from "path";
import { rmSync } from "fs";
import type { AgentInfo, AgentOutfit, LogEntry, ModelFamily, SkillInfo } from "../../shared/types.ts";
import { computeBureauDiff, resolveDiffCwd } from "../bureau-diff.ts";
import { listAgentSessions, loadAgents, loadLogWithAncestors } from "../persistence.ts";
import { autocompleteCommands } from "./commands.ts";
import { generateOutfit } from "./outfit.ts";
import { addLogEntry, agents, emit, emitEphemeralLog, logCache, persistAll, setRooms, type ManagedAgent } from "./state.ts";
import { deduplicateSkills, discoverBundledSkills, discoverPluginSkills, discoverProjectSkills, discoverUserSkills } from "./skills-discovery.ts";
import { moveClaudeSessionFiles, resolveCwd } from "./session/paths.ts";
import { createSession, installSession, replaceSession } from "./session/runtime.ts";
import { findRoomIndex, updateState } from "./state.ts";
import { sidecarSend } from "./terminal.ts";

// ---------------------------------------------------------------------------
// Public read-only getters used by server/index.ts
// ---------------------------------------------------------------------------

export function getAgent(agentId: string): AgentInfo | undefined {
  return agents.get(agentId)?.info;
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

// Emit a styled diff card into an agent's chat. Mirrors the /bureau-diff slash
// command but driven by HTTP — agents call POST /agents/:id/diff to surface a
// diff when the boss asks for their changes in plain English.
export function emitAgentDiff(agentId: string, dir?: string): { ok: true } | { ok: false; status: number; error: string } {
  const managed = agents.get(agentId);
  if (!managed) return { ok: false, status: 404, error: "agent not found" };

  const resolved = resolveDiffCwd(dir, managed.info.cwd);
  if (resolved.kind === "bad_dir") {
    return { ok: false, status: 400, error: `\`${resolved.attempted}\` is not a directory.` };
  }

  const result = computeBureauDiff(resolved.cwd);
  switch (result.kind) {
    case "not_repo":
      emitEphemeralLog(agentId, "system", `\`${result.cwd}\` is not a git repository.`);
      break;
    case "git_error":
      emitEphemeralLog(agentId, "system", `Failed to run git diff in \`${result.cwd}\`:\n\n\`\`\`\n${result.message}\n\`\`\``);
      break;
    case "clean":
      emitEphemeralLog(agentId, "system", `Working tree clean in \`${result.cwd}\` — no uncommitted changes.`);
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
  changes: { name?: string; cwd?: string; outfit?: AgentInfo["outfit"]; customInstructions?: string; modelFamily?: ModelFamily; permissionMode?: AgentInfo["permissionMode"] },
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
    managed.info.cwd = resolveCwd(changes.cwd);
    updated.cwd = managed.info.cwd;
    moveClaudeSessionFiles(agentId, oldCwd, managed.info.cwd);
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

  if (Object.keys(updated).length === 0) return;

  // System prompt + cwd are passed into every createSession, so name/cwd/
  // customInstructions changes automatically apply to the next conversation.

  // Recreate session if model or permission mode changed so it takes effect immediately
  if (updated.modelFamily || updated.permissionMode) {
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
  modelFamily?: ModelFamily,
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
    state: "idle",
    topic: null,
    topicStale: false,
    customInstructions: customInstructions || null,
  };

  const managed: ManagedAgent = {
    info,
    session: null,
    sessionId: null,
    consumerPromise: null,
    pendingTurn: null,
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
    pendingPermission: null,
    ptySidecar: null,
    ptyBuffer: "",
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
    addLogEntry(id, "system", `Agent "${name}" ready. Working in ${resolvedCwd}. Permission mode: ${permissionMode}.`);
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
  if (managed.pendingPermission) {
    try {
      managed.pendingPermission.resolve({ behavior: "deny", message: "Agent killed." });
    } catch {}
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
    rmSync(join(homedir(), ".bureau", "launchers"), { recursive: true, force: true });
  } catch {}

  const loaded = loadAgents();
  setRooms(loaded.map((r) => ({ id: r.id, name: r.name, prompt: r.prompt, envFile: r.envFile })));

  for (let roomIdx = 0; roomIdx < loaded.length; roomIdx++) {
    for (const p of loaded[roomIdx].agents) {
      const info: AgentInfo = {
        id: p.id,
        name: p.name,
        desk: p.desk,
        room: roomIdx,
        cwd: p.cwd,
        outfit: p.outfit,
        permissionMode: p.permissionMode,
        modelFamily: p.modelFamily ?? "opus",
        state: p.lastSessionId ? "waiting_for_response" : "idle",
        topic: p.topic ?? null,
        topicStale: false,
        customInstructions: p.customInstructions ?? null,
      };
      const managed: ManagedAgent = {
        info,
        session: null,
        sessionId: p.lastSessionId,
        consumerPromise: null,
        pendingTurn: null,
        aborting: false,
        abortPromise: null,
        slashCommands: autocompleteCommands(),
        skills: deduplicateSkills([...discoverUserSkills(), ...discoverProjectSkills(p.cwd), ...discoverPluginSkills(), ...discoverBundledSkills()]),
        sdkReportedCommands: [],
        thinkingStartedAt: 0,
        toolCallTimestamps: new Map(),
        topicGenerating: false,
        topicMessageCount: 0,
        pendingResume: false,
        pendingResumeSessions: [],
        pendingModelPick: false,
        pendingPermission: null,
        ptySidecar: null,
        ptyBuffer: "",
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
          content: `Failed to restore on startup: ${err.message}`,
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
