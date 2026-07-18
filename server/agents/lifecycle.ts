import { join } from "path";
import { rmSync } from "fs";
import type { AgentBackendType, AgentInfo, AgentOutfit, LogEntry, SkillInfo } from "../../shared/types.ts";
import { listAgentSessions, loadAgents, loadLogWithAncestors } from "../persistence.ts";
import { generateTopic, TOPIC_REGEN_THRESHOLD } from "./topic.ts";
import { addLogEntry, agents, emit, logCache, persistAll, rooms as roomList, setRooms, type ManagedAgent } from "./state.ts";
import { createSession, installSession } from "./session/runtime.ts";
import { updateState } from "./state.ts";
import { BUREAU_DIR } from "../persistence/paths.ts";
import { mintAgentToken } from "./tokens.ts";
import { createManagedAgent } from "./managed-factory.ts";
import { buildSpawnAgentDraft } from "./lifecycle-spawn.ts";
import { buildRestoredAgentInfo } from "./lifecycle-restore.ts";

export type AgentContextUsageResponse =
  | {
      available: true;
      model: string;
      totalTokens: number;
      maxTokens: number;
      percentage: number;
      sampledAtMs: number;
    }
  | { available: false; reason: "no_session" | "not_yet_measured" };

export { emitAgentDiff, emitAgentEditFile, emitAgentPreviewUrl, emitAgentReadFile, emitAgentTerminalCommand, openEditorFile, resolveEditorPathForAgent, saveEditorFile } from "./affordances.ts";
export { kill } from "./lifecycle-kill.ts";
export { getKilledAgentSummaries, revive } from "./revive.ts";

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

export async function getAgentContextUsage(agentId: string): Promise<AgentContextUsageResponse> {
  const managed = agents.get(agentId);
  if (!managed) return { available: false, reason: "no_session" };
  if (!managed.session && !managed.sessionId) return { available: false, reason: "no_session" };
  if (!managed.session) return { available: false, reason: "not_yet_measured" };

  const ctx = await managed.session.getContextUsage().catch(() => null);
  if (!ctx) return { available: false, reason: "not_yet_measured" };
  return {
    available: true,
    model: ctx.model,
    totalTokens: ctx.totalTokens,
    maxTokens: ctx.maxTokens,
    percentage: ctx.percentage,
    sampledAtMs: Date.now(),
  };
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
  const draft = buildSpawnAgentDraft({
    name,
    desk,
    cwd,
    permissionMode,
    customInstructions,
    roomId,
    outfit,
    modelFamily,
    agentType,
    codexSandbox,
    effort,
    userId,
    agents: agents.values(),
    rooms: roomList,
  });
  if (!draft) return null;

  const { info, resolvedCwd } = draft;
  const managed = createManagedAgent({ info, skillCwd: resolvedCwd });
  agents.set(info.id, managed);
  mintAgentToken(info.id, info.userId ?? null, info.privileged ?? false);
  emit({ type: "agent_added", agent: info });
  // Send commands immediately so autocomplete works before SDK init
  emit({
    type: "slash_commands",
    agentId: info.id,
    commands: managed.slashCommands,
    skills: managed.skills,
  } as any);
  persistAll();

  // Create V2 session
  try {
    installSession(info.id, managed, createSession(managed));
    addLogEntry(info.id, "system", `${agentType === "codex" ? "Codex" : "Claude"} agent "${name}" ready. Working in ${resolvedCwd}. Permission mode: ${permissionMode}.`);
    // First stream() will deliver system/init + response to the first send().
  } catch (err: any) {
    console.error(`Failed to create session for ${name}:`, err.message);
    addLogEntry(info.id, "error", `Failed to start: ${err.message}`);
    updateState(info.id, "error");
  }

  return info;
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
      const info = buildRestoredAgentInfo(p, roomIdx);
      mintAgentToken(p.id, info.userId ?? null, info.privileged ?? false);
      const managed = createManagedAgent({
        info,
        skillCwd: p.cwd,
        sessionId: p.lastSessionId,
        topicMessageCount: persistedTopicCount,
      });
      managed.messageQueue = Array.isArray(p.queue) ? [...p.queue] : [];
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
  for (const managed of agents.values()) {
    if (managed.messageQueue.length === 0 || managed.info.state === "error" || managed.info.state === "stopped") continue;
    import("./conversation/message-queue.ts")
      .then(({ flushQueue }) =>
        flushQueue(managed.info.id).catch((err: any) => {
          console.error(`flushQueue failed for restored agent ${managed.info.id}:`, err.message);
        }),
      )
      .catch((err) => {
        console.error("failed to load flushQueue module:", err);
      });
  }
  return [...agents.values()].map((a) => a.info);
}
