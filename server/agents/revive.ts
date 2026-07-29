import { homedir } from "os";
import { join } from "path";
import { statSync } from "fs";
import type { AgentBackendType, AgentInfo, KilledAgentSummary } from "../../shared/types.ts";
import { DEFAULT_AGENT_CAPABILITIES } from "../../shared/types.ts";
import { getSessionCwd, listAgentSessions, loadAgentHistory, loadLogWithAncestors, type AgentHistoryEntry } from "../persistence.ts";
import { LOGS_DIR } from "../persistence/paths.ts";
import { getBackend } from "../backends/index.ts";
import { generateOutfit } from "./outfit.ts";
import { createManagedAgent } from "./managed-factory.ts";
import { addLogEntry, agents, emit, logCache, persistAll, rooms as roomList, type ManagedAgent } from "./state.ts";
import { findRoomIndex } from "./state.ts";
import { validateCwd } from "./session/paths.ts";
import { createSession, installSession } from "./session/runtime.ts";
import { mintAgentToken, revokeAgentToken } from "./tokens.ts";

// Wire-summary chip payload for a live agent at kill time. Returns null if the
// agent's room no longer exists (no provenance to ACL-filter against).
export function buildKilledAgentSummary(agentId: string, a: ManagedAgent): KilledAgentSummary | null {
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
  emit({ type: "slash_commands", agentId, commands: managed.slashCommands, skills: managed.skills });
  addLogEntry(agentId, "system", `Revived ${agentType === "codex" ? "Codex" : "Claude"} agent "${info.name}" at ${resolvedCwd}.`);
  persistAll();
  emit({ type: "killed_agent_removed", agentId, lastRoomId: entry.lastRoomId });
  return { ok: true, agent: info };
}
