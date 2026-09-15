import type { ExperimentalSettings, RoomPet, RoomSkin, RoomWire } from "../../shared/types.ts";
import { generateRoomId, normalizeRoomPet, parseRoomSkin } from "../../shared/types.ts";
import { DESK_COUNT, isValidDesk } from "../../shared/desks.ts";
import { versionOf } from "../memory-store.ts";
import { readEnvFile, saveOfficeConfig } from "../persistence.ts";
import { agents, emit, findRoomIndex, officeConfig, persistAll, roomsWire, rooms, setOfficeConfig, type InternalRoom } from "./state.ts";

export function getRooms(): RoomWire[] {
  return roomsWire();
}

/** Content hash over the office settings PUT surface (prompt + envFile + experimental). */
export function officeSettingsVersion(settings?: { prompt: string | null; envFile: string | null; experimental?: ExperimentalSettings }): string {
  const s = settings ?? {
    prompt: officeConfig.prompt,
    envFile: officeConfig.envFile,
    experimental: officeConfig.experimental,
  };
  return versionOf(JSON.stringify([s.prompt ?? null, s.envFile ?? null, s.experimental ?? officeConfig.experimental]));
}

// Update office settings. Caller is responsible for validating envFile (see validateEnvPath).
export function setOfficeSettings(prompt: string | null, envFile: string | null, experimental?: ExperimentalSettings) {
  const normalizedPrompt = prompt && prompt.trim() ? prompt.trim() : null;
  const nextConfig = {
    ...officeConfig,
    prompt: normalizedPrompt,
    envFile: envFile || null,
    experimental: experimental ?? officeConfig.experimental,
  };
  setOfficeConfig(nextConfig);
  saveOfficeConfig(nextConfig);
  // System prompt is rebuilt at every createSession from current office/room/agent
  // config, so the new office prompt automatically lands on the next conversation.
  emit({
    type: "office_settings_updated",
    prompt: nextConfig.prompt,
    envFile: nextConfig.envFile,
    experimental: nextConfig.experimental,
  });
}

export function setRoomSettings(roomId: string, prompt: string | null, envFile: string | null): boolean {
  const idx = findRoomIndex(roomId);
  if (idx < 0) return false;
  const room = rooms[idx];
  room.prompt = prompt && prompt.trim() ? prompt.trim() : null;
  room.envFile = envFile || null;
  persistAll();
  // System prompt is rebuilt at every createSession — next conversation picks up
  // the new room prompt automatically.
  emit({ type: "room_settings_updated", roomId, prompt: room.prompt, envFile: room.envFile });
  return true;
}

/** Content hash over the room settings PUT surface (prompt + envFile + pet + skin). */
export function roomSettingsVersion(settings: { prompt: string | null; envFile: string | null; pet?: unknown; skin?: unknown }): string {
  const skinParsed = parseRoomSkin(settings.skin);
  return versionOf(
    JSON.stringify({
      prompt: settings.prompt ?? null,
      envFile: settings.envFile ?? null,
      pet: normalizeRoomPet(settings.pet),
      skin: skinParsed.ok ? skinParsed.skin : null,
    }),
  );
}

export function getRoomSettings(roomId: string): { prompt: string | null; envFile: string | null; pet: RoomPet | null; skin: RoomSkin | null } | null {
  const idx = findRoomIndex(roomId);
  if (idx < 0) return null;
  const room = rooms[idx];
  return { prompt: room.prompt, envFile: room.envFile, pet: normalizeRoomPet(room.pet), skin: room.skin ?? null };
}

export function setRoomPet(roomId: string, pet: RoomPet | null): boolean {
  const idx = findRoomIndex(roomId);
  if (idx < 0) return false;
  const room = rooms[idx];
  room.pet = normalizeRoomPet(pet);
  persistAll();
  emit({ type: "room_pet_updated", roomId, pet: room.pet });
  return true;
}

export function setRoomSkin(roomId: string, skin: RoomSkin | null): boolean {
  const idx = findRoomIndex(roomId);
  if (idx < 0) return false;
  const room = rooms[idx];
  room.skin = skin;
  persistAll();
  emit({ type: "room_skin_updated", roomId, skin });
  return true;
}

// Validate an env file path. Returns key count on success, throws on failure.
export function validateEnvPath(path: string): number {
  const parsed = readEnvFile(path);
  return Object.keys(parsed).length;
}

export function swapDesks(deskA: number, deskB: number, roomId: string) {
  if (deskA === deskB || !isValidDesk(deskA) || !isValidDesk(deskB)) return;
  const roomIdx = findRoomIndex(roomId);
  if (roomIdx < 0) return;
  const allManaged = [...agents.values()];
  const agentA = allManaged.find((m) => m.info.desk === deskA && m.info.room === roomIdx);
  const agentB = allManaged.find((m) => m.info.desk === deskB && m.info.room === roomIdx);
  if (!agentA && !agentB) return;

  if (agentA) {
    agentA.info.desk = deskB;
    emit({ type: "agent_updated", agentId: agentA.info.id, changes: { desk: deskB } });
  }
  if (agentB) {
    agentB.info.desk = deskA;
    emit({ type: "agent_updated", agentId: agentB.info.id, changes: { desk: deskA } });
  }
  persistAll();
}

export function createRoom(name?: string): string {
  const existingIds = rooms.map((r) => r.id);
  const id = generateRoomId(existingIds);
  const displayName = (name || `Room ${rooms.length + 1}`).trim().slice(0, 40);
  const room: InternalRoom = { id, name: displayName, prompt: null, envFile: null, pet: null, skin: null };
  rooms.push(room);
  persistAll();
  emit({
    type: "room_created",
    room: { id: room.id, name: room.name, prompt: room.prompt, envFile: room.envFile, pet: room.pet, skin: room.skin },
  });
  return id;
}

export function closeRoom(roomId: string): boolean {
  const roomIdx = findRoomIndex(roomId);
  if (roomIdx <= 0) return false; // Room 1 is permanent, and unknown ids reject
  // Check room is empty
  const roomAgents = [...agents.values()].filter((a) => a.info.room === roomIdx);
  if (roomAgents.length > 0) return false;

  rooms.splice(roomIdx, 1);
  // Renumber agents in higher rooms
  for (const managed of agents.values()) {
    if (managed.info.room > roomIdx) {
      managed.info.room--;
      emit({ type: "agent_updated", agentId: managed.info.id, changes: { room: managed.info.room } });
    }
  }
  persistAll();
  emit({ type: "room_closed", roomId });
  return true;
}

export function renameRoom(roomId: string, name: string): boolean {
  const roomIdx = findRoomIndex(roomId);
  if (roomIdx < 0) return false;
  const trimmed = name.trim().slice(0, 40);
  if (!trimmed) return false;
  rooms[roomIdx].name = trimmed;
  // Room name appears in the system prompt header; it's rebuilt at every
  // createSession, so agents in this room pick up the new name on their next
  // conversation automatically.
  persistAll();
  emit({ type: "room_renamed", roomId, name: trimmed });
  return true;
}

export function reorderRooms(order: string[]): boolean {
  // Must be a permutation of the existing room ids
  if (order.length !== rooms.length) return false;
  const currentIds = new Set(rooms.map((r) => r.id));
  const seen = new Set<string>();
  for (const id of order) {
    if (typeof id !== "string" || !currentIds.has(id) || seen.has(id)) return false;
    seen.add(id);
  }
  // No-op check
  if (order.every((id, i) => id === rooms[i].id)) return false;

  // Build reverseMap: oldIdx → newIdx, keyed by current position.
  const oldIndexById = new Map(rooms.map((r, i) => [r.id, i] as const));
  const reverseMap = new Array<number>(rooms.length);
  for (let newIdx = 0; newIdx < order.length; newIdx++) {
    reverseMap[oldIndexById.get(order[newIdx])!] = newIdx;
  }

  // Reorder rooms in place so that the `rooms` reference in state.ts stays valid.
  const byId = new Map(rooms.map((r) => [r.id, r] as const));
  rooms.splice(0, rooms.length, ...order.map((id) => byId.get(id)!));

  // Remap every agent's room index (no individual agent_updated — clients
  // remap atomically from the rooms_reordered message)
  for (const managed of agents.values()) {
    managed.info.room = reverseMap[managed.info.room];
  }

  persistAll();
  emit({ type: "rooms_reordered", order });
  return true;
}

export function moveAgent(agentId: string, targetRoomId: string): boolean {
  const managed = agents.get(agentId);
  if (!managed) return false;
  const targetIdx = findRoomIndex(targetRoomId);
  if (targetIdx < 0) return false;
  if (managed.info.room === targetIdx) return false;

  // Find first available desk in target room
  const targetAgents = [...agents.values()].filter((a) => a.info.room === targetIdx);
  if (targetAgents.length >= DESK_COUNT) return false;
  const taken = new Set(targetAgents.map((a) => a.info.desk));
  let newDesk = -1;
  for (let i = 0; i < DESK_COUNT; i++) {
    if (!taken.has(i)) {
      newDesk = i;
      break;
    }
  }
  if (newDesk === -1) return false;

  managed.info.room = targetIdx;
  managed.info.desk = newDesk;
  // New room's prompt context is picked up on the agent's next conversation
  // since the system prompt is rebuilt at every createSession.
  emit({ type: "agent_updated", agentId, changes: { room: targetIdx, desk: newDesk } });
  persistAll();
  return true;
}
