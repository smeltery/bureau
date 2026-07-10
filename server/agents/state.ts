import type { AgentState, Attachment, LogEntry, OfficeSettings, RoomWire } from "../../shared/types.ts";
import { DEFAULT_AGENT_CAPABILITIES, FAMILY_TO_MODEL, generateRoomId } from "../../shared/types.ts";
import { appendLog, loadAgentHistory, loadOfficeConfig, saveAgentHistory, saveAgents, writeManifest, type AgentHistory, type OfficeConfig, type PersistedAgent, type Room } from "../persistence.ts";
import { getUserById } from "../users.ts";
import type { AgentEvent, EventHandler, InternalRoom, ManagedAgent } from "./state-types.ts";
export type { AgentEvent, EventHandler, InternalRoom, ManagedAgent } from "./state-types.ts";

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
  // import dodges the state↔queue circular dependency.
  if (wasBusy && !isAgentBusy(state) && managed.messageQueue.length > 0) {
    import("./conversation/message-queue.ts")
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
      userId: a.info.userId ?? null,
      managerName: a.info.userId ? (getUserById(a.info.userId)?.name ?? null) : null,
      privileged: a.info.privileged ?? false,
      desk: a.info.desk,
      room: a.info.room,
      roomId: rooms[a.info.room]?.id ?? a.info.roomId ?? "",
      roomName: rooms[a.info.room]?.name ?? `Room ${a.info.room + 1}`,
      topic: a.info.topic,
      cwd: a.info.cwd,
      agentType: a.info.agentType,
      capabilities: a.info.capabilities,
      modelFamily: a.info.modelFamily,
      model: FAMILY_TO_MODEL[a.info.modelFamily as keyof typeof FAMILY_TO_MODEL] ?? a.info.modelFamily,
      lastSessionId: a.sessionId,
    })),
  );
}

// Snapshot live agents into history. The loop only iterates the live `agents`
// map, so killed entries are preserved as-is (their `killedAt` and revive
// payload stamped by kill() survive). Two consumers: /usage attribution for
// killed agents, and the spawn menu's revive chips (which read the snapshot to
// rehydrate config). Entries are never removed; live agents keep `killedAt:
// null`, kill() stamps the kill time.
export function updateAgentHistory() {
  const history: AgentHistory = loadAgentHistory();
  for (const a of agents.values()) {
    const room = rooms[a.info.room];
    if (!room) continue;
    history[a.info.id] = {
      name: a.info.name,
      userId: a.info.userId ?? null,
      lastRoomId: room.id,
      lastRoomName: room.name,
      killedAt: null,
      cwd: a.info.cwd,
      outfit: a.info.outfit,
      permissionMode: a.info.permissionMode,
      modelFamily: a.info.modelFamily,
      effort: a.info.effort,
      agentType: a.info.agentType,
      privileged: a.info.privileged ?? false,
      codexSandbox: a.info.codexSandbox,
      lastSessionId: a.sessionId,
      topic: a.info.topic,
      customInstructions: a.info.customInstructions,
    };
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
        userId: a.info.userId ?? null,
        desk: a.info.desk,
        cwd: a.info.cwd,
        outfit: a.info.outfit,
        permissionMode: a.info.permissionMode,
        modelFamily: a.info.modelFamily,
        agentType: a.info.agentType,
        privileged: a.info.privileged ?? false,
        codexSandbox: a.info.codexSandbox,
        effort: a.info.effort,
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
