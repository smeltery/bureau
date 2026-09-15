import { FAMILY_TO_MODEL } from "../../shared/types.ts";
import { loadAgentHistory, saveAgentHistory, saveAgents, writeManifest, type AgentHistory, type PersistedAgent, type Room } from "../persistence.ts";
import { getUserById } from "../users.ts";
import { queueDedupeForPersist } from "./conversation/queue-dedupe.ts";
import type { InternalRoom, ManagedAgent } from "./state-types.ts";

export function writeAgentsManifest(agents: Iterable<ManagedAgent>, rooms: InternalRoom[]) {
  writeManifest(
    [...agents].map((a) => ({
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
      effort: a.info.effort,
      permissionMode: a.info.permissionMode,
      sandbox: a.info.codexSandbox ?? null,
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
export function saveLiveAgentHistory(agents: Iterable<ManagedAgent>, rooms: InternalRoom[]) {
  const history: AgentHistory = loadAgentHistory();
  for (const a of agents) {
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

export function saveLiveAgents(agents: Iterable<ManagedAgent>, rooms: InternalRoom[]) {
  const persistedRooms: Room[] = rooms.map((r) => ({
    id: r.id,
    name: r.name,
    prompt: r.prompt,
    envFile: r.envFile,
    pet: r.pet ?? null,
    skin: r.skin ?? null,
    agents: [] as PersistedAgent[],
  }));
  for (const a of agents) {
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
        queue: a.messageQueue,
        queueDedupe: queueDedupeForPersist(a),
      });
    }
  }
  saveAgents(persistedRooms);
}
