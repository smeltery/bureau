import { homedir } from "os";
import { join } from "path";
import { rmSync, statSync } from "fs";
import type { AgentBackendType, AgentInfo, AgentOutfit, KilledAgentSummary, LogEntry, SkillInfo } from "../../shared/types.ts";
import { DEFAULT_AGENT_CAPABILITIES, KILLED_AGENT_CHIP_CAP } from "../../shared/types.ts";
import { listAgentSessions, loadAgents, loadAgentHistory, loadLogWithAncestors, saveAgentHistory, getSessionCwd, type AgentHistoryEntry } from "../persistence.ts";
import { generateOutfit } from "./outfit.ts";
import { generateTopic, TOPIC_REGEN_THRESHOLD } from "./topic.ts";
import { addLogEntry, agents, emit, logCache, persistAll, rooms as roomList, setRooms, type ManagedAgent } from "./state.ts";
import { resolveCwd, validateCwd } from "./session/paths.ts";
import { createSession, installSession } from "./session/runtime.ts";
import { getBackend } from "../backends/index.ts";
import { findRoomIndex, updateState } from "./state.ts";
import { sidecarSend } from "./terminal.ts";
import { BUREAU_DIR, LOGS_DIR } from "../persistence/paths.ts";
import { mintAgentToken, revokeAgentToken } from "./tokens.ts";
import { createManagedAgent } from "./managed-factory.ts";

export { emitAgentDiff, emitAgentEditFile, emitAgentReadFile, emitAgentTerminalCommand, openEditorFile, resolveEditorPathForAgent, saveEditorFile } from "./affordances.ts";

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
    privileged: false,
    ...(codexSandbox ? { codexSandbox } : {}),
    ...(effort ? { effort } : {}),
    state: "idle",
    topic: null,
    topicStale: false,
    customInstructions: customInstructions || null,
    queue: [],
  };

  const managed = createManagedAgent({ info, skillCwd: resolvedCwd });
  agents.set(id, managed);
  mintAgentToken(id, info.userId ?? null, info.privileged ?? false);
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
        userId: managed.info.userId ?? null,
        lastRoomId: room.id,
        lastRoomName: room.name,
        killedAt: Date.now(),
        cwd: managed.info.cwd,
        outfit: managed.info.outfit,
        permissionMode: managed.info.permissionMode,
        modelFamily: managed.info.modelFamily,
        effort: managed.info.effort,
        agentType: managed.info.agentType,
        privileged: managed.info.privileged ?? false,
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
  revokeAgentToken(agentId);
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
    userId: entry.userId ?? null,
    desk,
    room: roomIdx,
    cwd: resolvedCwd,
    outfit: entry.outfit ?? generateOutfit(),
    permissionMode: entry.permissionMode ?? "default",
    modelFamily: entry.modelFamily ?? "opus",
    agentType,
    capabilities: getBackend(agentType).capabilities ?? DEFAULT_AGENT_CAPABILITIES,
    privileged: entry.privileged ?? false,
    ...(entry.codexSandbox ? { codexSandbox: entry.codexSandbox } : {}),
    ...(entry.effort ? { effort: entry.effort } : {}),
    state: resumeFromSession ? "waiting_for_response" : "idle",
    topic: entry.topic ?? null,
    topicStale: false,
    customInstructions: entry.customInstructions ?? null,
    queue: [],
  };

  const persistedTopicCount = resumeFromSession ? (listAgentSessions(agentId).find((s) => s.sessionId === resumeFromSession)?.topicMessageCount ?? 0) : 0;
  const managed = createManagedAgent({
    info,
    skillCwd: resolvedCwd,
    sessionId: resumeFromSession,
    topicMessageCount: persistedTopicCount,
  });
  mintAgentToken(agentId, info.userId ?? null, info.privileged ?? false);
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
    revokeAgentToken(agentId);
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
        userId: p.userId ?? null,
        desk: p.desk,
        room: roomIdx,
        cwd: p.cwd,
        outfit: p.outfit,
        permissionMode: p.permissionMode,
        modelFamily: p.modelFamily ?? "opus",
        agentType: p.agentType ?? "claude",
        capabilities: getBackend(p.agentType ?? "claude").capabilities ?? DEFAULT_AGENT_CAPABILITIES,
        privileged: p.privileged ?? false,
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
      mintAgentToken(p.id, info.userId ?? null, info.privileged ?? false);
      const managed = createManagedAgent({
        info,
        skillCwd: p.cwd,
        sessionId: p.lastSessionId,
        topicMessageCount: persistedTopicCount,
      });
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
