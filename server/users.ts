import type { AgentInfo, RoomWire, SessionContext, SessionWire, UserRecord, UserRole } from "../shared/types.ts";
import { loadUsers, saveUsers, normalizeUserKey, generateUserId } from "./persistence.ts";
import { defaultGhostColorForUserId, isGhostVariant, isHexColor, normalizeHexColor } from "../shared/avatar.ts";

const users = new Map<string, UserRecord>();
const wsUsers = new WeakMap<import("bun").ServerWebSocket<unknown>, UserRecord>();
const sessionPrefixes = new WeakMap<import("bun").ServerWebSocket<unknown>, string>();
const connectedAt = new WeakMap<import("bun").ServerWebSocket<unknown>, number>();
const lastSeenAt = new WeakMap<import("bun").ServerWebSocket<unknown>, number>();
const activeSockets = new Set<import("bun").ServerWebSocket<unknown>>();

for (const user of loadUsers()) users.set(normalizeUserKey(user.name), user);

function persist() {
  saveUsers([...users.values()]);
}

function validRoomSet(roomIds: string[]): Set<string> {
  return new Set(roomIds);
}

function normalizeAllowedRooms(value: unknown, allRoomIds: string[]): string[] {
  const valid = validRoomSet(allRoomIds);
  const raw = Array.isArray(value) ? value : allRoomIds;
  return raw.filter((id): id is string => typeof id === "string" && valid.has(id));
}

function ensureUserRooms(user: UserRecord, allRoomIds: string[]): UserRecord {
  const allowedRooms = normalizeAllowedRooms(user.allowedRooms, allRoomIds);
  const nextAllowed = user.role === "owner" && allowedRooms.length === 0 ? allRoomIds : allowedRooms;
  const defaultRoomId = user.defaultRoomId && nextAllowed.includes(user.defaultRoomId) ? user.defaultRoomId : (nextAllowed[0] ?? null);
  if (nextAllowed.length === user.allowedRooms.length && nextAllowed.every((id, i) => id === user.allowedRooms[i]) && defaultRoomId === user.defaultRoomId) return user;
  const next = { ...user, allowedRooms: nextAllowed, defaultRoomId };
  users.set(normalizeUserKey(next.name), next);
  persist();
  return next;
}

export function claimUser(ws: import("bun").ServerWebSocket<unknown>, username: string, rooms: RoomWire[]): UserRecord {
  const trimmed = username.trim().slice(0, 64);
  const name = trimmed || "Boss";
  const key = normalizeUserKey(name);
  const allRoomIds = rooms.map((r) => r.id);
  let user = users.get(key);
  if (!user) {
    const role: UserRole = users.size === 0 ? "owner" : "member";
    const id = generateUserId([...users.values()].map((u) => u.id));
    user = {
      id,
      name,
      role,
      allowedRooms: allRoomIds,
      defaultRoomId: allRoomIds[0] ?? null,
      avatarColor: defaultGhostColorForUserId(id),
      avatarVariant: "classic",
      createdAt: Date.now(),
    };
    users.set(key, user);
    persist();
  }
  user = ensureUserRooms(user, allRoomIds);
  wsUsers.set(ws, user);
  activeSockets.add(ws);
  if (!sessionPrefixes.has(ws)) sessionPrefixes.set(ws, Math.random().toString(16).slice(2, 10).padEnd(8, "0"));
  if (!connectedAt.has(ws)) connectedAt.set(ws, Date.now());
  lastSeenAt.set(ws, Date.now());
  return user;
}

export function getWsUser(ws: import("bun").ServerWebSocket<unknown>): UserRecord | null {
  const user = wsUsers.get(ws);
  return user ?? null;
}

export function clearWsUser(ws: import("bun").ServerWebSocket<unknown>) {
  wsUsers.delete(ws);
  activeSockets.delete(ws);
  sessionPrefixes.delete(ws);
  connectedAt.delete(ws);
  lastSeenAt.delete(ws);
}

export function getSessionContext(ws: import("bun").ServerWebSocket<unknown>): SessionContext | null {
  const user = getWsUser(ws);
  if (!user) return null;
  return {
    userId: user.id,
    username: user.name,
    role: user.role,
    currentSessionPrefix: sessionPrefixes.get(ws) ?? "",
    connectionId: sessionPrefixes.get(ws) ?? "",
  };
}

export function listUsers(rooms: RoomWire[]): UserRecord[] {
  const allRoomIds = rooms.map((r) => r.id);
  return [...users.values()].map((u) => ensureUserRooms(u, allRoomIds)).sort((a, b) => a.name.localeCompare(b.name));
}

export function updateUser(
  actor: UserRecord | null,
  userId: string,
  changes: Partial<Pick<UserRecord, "name" | "role" | "allowedRooms" | "defaultRoomId" | "avatarColor" | "avatarVariant">>,
  rooms: RoomWire[],
): UserRecord | null {
  if (!actor) return null;
  const target = [...users.values()].find((u) => u.id === userId);
  if (!target) return null;
  const canEdit = actor.role === "owner" || actor.id === target.id;
  if (!canEdit) return null;
  const allRoomIds = rooms.map((r) => r.id);
  const next: UserRecord = { ...target };
  if (typeof changes.name === "string") {
    const name = changes.name.trim().slice(0, 64);
    if (name) next.name = name;
  }
  if (actor.role === "owner") {
    if (changes.role === "owner" || changes.role === "member") next.role = changes.role;
    if (changes.allowedRooms) next.allowedRooms = normalizeAllowedRooms(changes.allowedRooms, allRoomIds);
  }
  if (changes.defaultRoomId !== undefined) {
    next.defaultRoomId = typeof changes.defaultRoomId === "string" && next.allowedRooms.includes(changes.defaultRoomId) ? changes.defaultRoomId : null;
  }
  if (changes.avatarColor !== undefined && isHexColor(changes.avatarColor)) next.avatarColor = normalizeHexColor(changes.avatarColor);
  if (changes.avatarVariant !== undefined && isGhostVariant(changes.avatarVariant)) next.avatarVariant = changes.avatarVariant;
  if (next.role === "owner" && next.allowedRooms.length === 0) next.allowedRooms = allRoomIds;
  users.delete(normalizeUserKey(target.name));
  users.set(normalizeUserKey(next.name), next);
  persist();
  return next;
}

export function deleteUser(actor: UserRecord | null, userId: string): boolean {
  if (!actor || actor.role !== "owner" || actor.id === userId) return false;
  const target = [...users.values()].find((u) => u.id === userId);
  if (!target) return false;
  users.delete(normalizeUserKey(target.name));
  persist();
  return true;
}

export function canSeeRoom(user: UserRecord | null, roomId: string): boolean {
  if (!user) return true;
  if (user.role === "owner") return true;
  return user.allowedRooms.includes(roomId);
}

export function projectRooms(user: UserRecord | null, rooms: RoomWire[]): RoomWire[] {
  if (!user || user.role === "owner") return rooms;
  return rooms.filter((r) => user.allowedRooms.includes(r.id));
}

export function projectAgents(user: UserRecord | null, agents: AgentInfo[], rooms: RoomWire[]): AgentInfo[] {
  if (!user || user.role === "owner") return agents;
  const visibleRoomIds = new Set(user.allowedRooms);
  const projectedIndex = new Map(projectRooms(user, rooms).map((room, index) => [room.id, index]));
  return agents
    .filter((agent) => visibleRoomIds.has(rooms[agent.room]?.id ?? ""))
    .map((agent) => {
      const roomId = rooms[agent.room]?.id;
      const room = roomId ? projectedIndex.get(roomId) : undefined;
      return room === undefined ? agent : { ...agent, room };
    });
}

export function listActiveSessions(): SessionWire[] {
  const now = Date.now();
  return [...activeSockets]
    .map((ws) => {
      const user = wsUsers.get(ws);
      const sessionPrefix = sessionPrefixes.get(ws);
      if (!user || !sessionPrefix) return null;
      return {
        sessionPrefix,
        username: user.name,
        createdAt: connectedAt.get(ws) ?? now,
        lastSeenAt: lastSeenAt.get(ws) ?? now,
        expiresAt: now + 30 * 86400000,
        absoluteExpiresAt: now + 365 * 86400000,
      } satisfies SessionWire;
    })
    .filter((s): s is SessionWire => s !== null);
}
