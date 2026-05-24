import type { unstable_v2_createSession, PermissionResult, PermissionUpdate } from "@anthropic-ai/claude-agent-sdk";
import type { AgentInfo, AgentState, Attachment, LogEntry, OfficeSettings, RoomWire, SkillInfo } from "../../shared/types.ts";
import { FAMILY_TO_MODEL, generateRoomId } from "../../shared/types.ts";
import { appendLog, loadAgentHistory, loadOfficeConfig, saveAgentHistory, saveAgents, writeManifest, type AgentHistory, type OfficeConfig, type PersistedAgent, type Room } from "../persistence.ts";

// ---------------------------------------------------------------------------
// Internal types
// ---------------------------------------------------------------------------

// Internal agent state
export interface ManagedAgent {
  info: AgentInfo;
  session: ReturnType<typeof unstable_v2_createSession> | null;
  sessionId: string | null;
  // Persistent consumer loop iterating `session.stream()` for the session's
  // lifetime. See docs/held-back-messages-investigation.md — without this,
  // task_notifications buffered between turns get flushed one turn late.
  consumerPromise: Promise<void> | null;
  // Per-turn deferred. sendMessage/executeSkill await this; the consumer
  // resolves it when the turn's `stream()` iterator ends at `result`.
  pendingTurn: { resolve: () => void; reject: (err: unknown) => void } | null;
  // The aggregate `afterTurn` promise for the most recent turn — all plugins'
  // afterTurn hooks raced against their per-plugin timeout, joined here.
  // runAgentTurn awaits this before starting the next turn so memory writes
  // / audit writes / etc. land before the next retrieval. Self-clears on
  // settle (set to null inside runAfterTurn's .finally) so a timed-out
  // afterTurn doesn't poison every subsequent turn with a 10s wait.
  afterTurnPromise: Promise<void> | null;
  // Monotonic counter bumped by every control-plane action that cancels an
  // in-flight turn (abort, kill, replaceSession). runAgentTurn snapshots it
  // at entry — AFTER beginTurn flips state to thinking — and re-checks
  // after each await during plugin retrieval. Any change means a Stop or
  // session swap fired while plugin work was running, so the pre-send turn
  // bails with SessionSwappedError instead of sending the stale prompt
  // into the (possibly swapped) session. The pre-send window between
  // beginTurn and createTurnDeferred is the only place plain `pendingTurn`
  // rejection can't cover, because pendingTurn isn't installed yet — this
  // counter fills that gap.
  turnCancelToken: number;
  aborting: boolean;
  // Set while abort() is mid-flight (between session.close() and installSession of the
  // replacement). sendMessage awaits this so a follow-up message arriving in the gap
  // doesn't see session=null and amputate context by spinning up a fresh blank session.
  abortPromise: Promise<void> | null;
  slashCommands: { name: string; description?: string; aliasFor?: string }[];
  skills: SkillInfo[];
  sdkReportedCommands: string[]; // commands reported by SDK in system:init
  // Timing: track when phases start for duration_ms computation
  thinkingStartedAt: number;
  toolCallTimestamps: Map<string, number>; // toolUseId → start timestamp
  // Topic generation
  topicGenerating: boolean;
  topicMessageCount: number; // text entry count when topic was last generated
  // /resume two-step state
  pendingResume: boolean;
  pendingResumeSessions: { sessionId: string; lastModified: number; topic: string | null; topicMessageCount: number }[];
  // /model two-step state
  pendingModelPick: boolean;
  // Auto-mode permission prompt two-step state
  pendingPermission: {
    toolUseID: string;
    input: Record<string, unknown>;
    suggestions?: PermissionUpdate[];
    resolve: (r: PermissionResult) => void;
  } | null;
  // Terminal PTY sidecar (spawned on demand via Node.js)
  ptySidecar: import("bun").Subprocess | null;
  ptyBuffer: string; // buffered output for reconnecting browsers
  // Pending messages queued while the agent was busy. Flushed together
  // as the agent transitions to an idle state. In-memory only.
  messageQueue: import("../../shared/types.ts").QueuedMessage[];
  flushInProgress: boolean;
  // /usage tracking. The SDK's `result` reports session-cumulative totals,
  // which are written to sessions.json on every turn (`usage` field) along
  // with a per-turn snapshot (`usageSnapshots`). /usage reads those entries
  // and aggregates per agent. Forked sessions subtract the parent's
  // cumulative-at-the-fork-point so shared turns aren't double-counted.
  lastWrittenEntryId: string | null;
}

export type AgentEvent =
  | { type: "agent_added"; agent: AgentInfo }
  | { type: "agent_removed"; agentId: string }
  | { type: "agent_updated"; agentId: string; changes: Partial<AgentInfo> }
  | { type: "log_entry"; entry: LogEntry }
  | { type: "room_created"; room: RoomWire }
  | { type: "room_closed"; roomId: string }
  | { type: "room_renamed"; roomId: string; name: string }
  | { type: "room_settings_updated"; roomId: string; prompt: string | null; envFile: string | null }
  | { type: "office_settings_updated"; prompt: string | null; envFile: string | null }
  | { type: "rooms_reordered"; order: string[] };

export type EventHandler = (event: AgentEvent) => void;

// Internal room state: an ordered list of rooms, each with a stable id and its
// own settings. Agent membership is tracked on the agents map (agent.info.room
// is the index into this array — kept in sync for rendering).
export interface InternalRoom {
  id: string;
  name: string;
  prompt: string | null;
  envFile: string | null;
}

// ---------------------------------------------------------------------------
// Mutable singletons
// ---------------------------------------------------------------------------

export const agents = new Map<string, ManagedAgent>();
export const logCache = new Map<string, LogEntry[]>(); // agentId → entries

let eventHandler: EventHandler = () => {};
export let officeConfig: OfficeConfig = loadOfficeConfig();
export let rooms: InternalRoom[] = [{ id: generateRoomId(), name: "Room 1", prompt: null, envFile: null }];

// Setters for modules that need to mutate the shared office/rooms state.
export function setOfficeConfig(next: OfficeConfig) {
  officeConfig = next;
}
export function setRooms(next: InternalRoom[]) {
  rooms = next;
}

// ---------------------------------------------------------------------------
// Room view helpers
// ---------------------------------------------------------------------------

export function roomsWire(): RoomWire[] {
  return rooms.map((r) => ({ id: r.id, name: r.name, prompt: r.prompt, envFile: r.envFile }));
}

export function findRoomIndex(roomId: string): number {
  return rooms.findIndex((r) => r.id === roomId);
}

export function getOfficeSettings(): OfficeSettings {
  return { prompt: officeConfig.prompt, envFile: officeConfig.envFile };
}

// ---------------------------------------------------------------------------
// Event emission
// ---------------------------------------------------------------------------

export function onEvent(handler: EventHandler) {
  eventHandler = handler;
}

export function emit(event: AgentEvent) {
  eventHandler(event);
}

// ---------------------------------------------------------------------------
// State mutation helpers used throughout the agent modules
// ---------------------------------------------------------------------------

// States where the agent isn't accepting new user input directly — pending
// messages go into the queue and flush when the agent transitions back.
const BUSY_STATES: ReadonlySet<AgentState> = new Set<AgentState>(["thinking", "tool_executing"]);

export function isAgentBusy(state: AgentState): boolean {
  return BUSY_STATES.has(state);
}

export function emitQueueUpdate(agentId: string, managed: ManagedAgent) {
  const queue = managed.messageQueue.slice();
  managed.info = { ...managed.info, queue };
  emit({ type: "agent_updated", agentId, changes: { queue } });
}

// Turn-start primitive. Stamps the per-turn "did a human originate this
// turn" flag and then transitions the agent into "thinking", in that
// order. The UI reads turnHadHumanInput at the working→attention
// transition to decide whether to fire the turn-end notification sound,
// so the flag must land before the state event. Every place that begins
// a new turn (flushQueue, sendMessage echo paths, editMessage, skill
// commands) goes through here.
export function beginTurn(agentId: string, opts: { humanInput: boolean }) {
  const managed = agents.get(agentId);
  if (!managed) return;
  if (managed.info.turnHadHumanInput !== opts.humanInput) {
    managed.info = { ...managed.info, turnHadHumanInput: opts.humanInput };
    emit({ type: "agent_updated", agentId, changes: { turnHadHumanInput: opts.humanInput } });
  }
  // Idempotency: runAgentTurn always calls beginTurn at the moment of send,
  // even when the call site already did an early-echo beginTurn (e.g.
  // sendMessage flipping the UI to "thinking" before the abortPromise
  // await). Re-entering updateState with state already === "thinking"
  // would re-emit an agent_updated event for an unchanged value; this
  // early-return keeps the second call free of side effects.
  if (managed.info.state === "thinking") return;
  updateState(agentId, "thinking");
}

export function updateState(agentId: string, state: AgentState) {
  const managed = agents.get(agentId);
  if (!managed) return;
  if (state === "thinking" && managed.info.state !== "thinking") {
    managed.thinkingStartedAt = Date.now();
  }
  const wasBusy = isAgentBusy(managed.info.state);
  managed.info = { ...managed.info, state };
  emit({ type: "agent_updated", agentId, changes: { state } });
  // Transitioning out of a busy state: flush any queued messages. Dynamic
  // import dodges the state↔send circular dependency.
  if (wasBusy && !isAgentBusy(state) && managed.messageQueue.length > 0) {
    import("./conversation/send.ts")
      .then(({ flushQueue }) =>
        flushQueue(agentId).catch((err: any) => {
          console.error(`flushQueue failed for ${agentId}:`, err.message);
        }),
      )
      .catch((err) => {
        console.error("failed to load flushQueue module:", err);
      });
  }
}

export function addLogEntry(
  agentId: string,
  kind: LogEntry["kind"],
  content: string,
  metadata?: Record<string, unknown>,
  attachments?: Attachment[],
  extra?: Partial<Pick<LogEntry, "diff" | "file" | "terminal">>,
) {
  const entry: LogEntry = {
    id: `log-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    agentId,
    timestamp: Date.now(),
    kind,
    content,
    metadata,
    ...(attachments && attachments.length > 0 ? { attachments } : {}),
    ...(extra ?? {}),
  };
  // Cache locally
  const cached = logCache.get(agentId) ?? [];
  cached.push(entry);
  logCache.set(agentId, cached);

  emit({ type: "log_entry", entry });

  const managed = agents.get(agentId);
  if (managed?.sessionId) {
    appendLog(agentId, managed.sessionId, entry);
    // Track the last entry actually written to this session's JSONL so that
    // /usage's per-turn snapshots have a stable anchor inside the log.
    managed.lastWrittenEntryId = entry.id;
  }

  // Track topicStale: new text entries after topic was generated
  if ((kind === "text" || kind === "user_message") && managed && managed.info.topic !== null && managed.info.topic !== "...") {
    const textCount = (logCache.get(agentId) ?? []).filter((e) => e.kind === "user_message" || e.kind === "text").length;
    if (textCount > managed.topicMessageCount) {
      managed.info.topicStale = true;
      emit({ type: "agent_updated", agentId, changes: { topicStale: true } });
    }
  }
}

// Emit a log entry to the UI only (not persisted to disk) — for ephemeral messages like /resume.
// Note: entries are still added to logCache for UI display. If sessionId is null when this is
// called, the backfill logic in processMessage (system/init) would write them to disk. In practice
// this doesn't happen because /resume requires existing sessions (sessionId already set).
export function emitEphemeralLog(agentId: string, kind: LogEntry["kind"], content: string, metadata?: Record<string, unknown>, extra?: Partial<Pick<LogEntry, "diff" | "file" | "terminal">>) {
  const entry: LogEntry = {
    id: `log-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    agentId,
    timestamp: Date.now(),
    kind,
    content,
    metadata,
    ...(extra ?? {}),
  };
  const cached = logCache.get(agentId) ?? [];
  cached.push(entry);
  logCache.set(agentId, cached);
  emit({ type: "log_entry", entry });
}

// ---------------------------------------------------------------------------
// Disk persistence of the aggregate state tree
// ---------------------------------------------------------------------------

export function updateManifest() {
  writeManifest(
    [...agents.values()].map((a) => ({
      id: a.info.id,
      name: a.info.name,
      desk: a.info.desk,
      room: a.info.room,
      roomName: rooms[a.info.room]?.name ?? `Room ${a.info.room + 1}`,
      topic: a.info.topic,
      cwd: a.info.cwd,
      modelFamily: a.info.modelFamily,
      model: FAMILY_TO_MODEL[a.info.modelFamily],
    })),
  );
}

// Track each live agent's current name + room so /usage can attribute killed
// agents (and agents whose rooms were later deleted) to the right bucket.
// Entries are never removed; they just stop getting refreshed once the agent
// is killed, which is exactly the behavior we want.
export function updateAgentHistory() {
  const history: AgentHistory = loadAgentHistory();
  for (const a of agents.values()) {
    const room = rooms[a.info.room];
    if (!room) continue;
    history[a.info.id] = { name: a.info.name, lastRoomId: room.id, lastRoomName: room.name };
  }
  saveAgentHistory(history);
}

export function persistAll() {
  const persistedRooms: Room[] = rooms.map((r) => ({
    id: r.id,
    name: r.name,
    prompt: r.prompt,
    envFile: r.envFile,
    agents: [] as PersistedAgent[],
  }));
  for (const a of agents.values()) {
    const room = a.info.room;
    if (room >= 0 && room < persistedRooms.length) {
      persistedRooms[room].agents.push({
        id: a.info.id,
        name: a.info.name,
        desk: a.info.desk,
        cwd: a.info.cwd,
        outfit: a.info.outfit,
        permissionMode: a.info.permissionMode,
        modelFamily: a.info.modelFamily,
        lastSessionId: a.sessionId,
        topic: a.info.topic,
        customInstructions: a.info.customInstructions,
      });
    }
  }
  saveAgents(persistedRooms);
  updateManifest();
  updateAgentHistory();
}
