import type { RoomWire, UserRecord, UserRole } from "../shared/types.ts";
import { loadUsers, saveUsers, normalizeUserKey, generateUserId } from "./persistence.ts";
import { reconcileUserRooms } from "./user-room-projection.ts";
import { bindWsUser, getBoundWsUser } from "./user-sockets.ts";
import { applyBootstrapUserChanges, applyInteractiveUserChanges, createUserRecord, type UserRecordChanges } from "./user-record-updates.ts";
export { projectAgents, projectRooms, listAccessibleRooms } from "./user-room-projection.ts";
export { clearWsUser, getSessionContext, listActiveSessions, setWsSessionPrefix } from "./user-sockets.ts";

const users = new Map<string, UserRecord>();

for (const user of loadUsers()) users.set(normalizeUserKey(user.name), user);

function persist() {
  saveUsers([...users.values()]);
}

// ---------------------------------------------------------------------------
// Lookups used by the auth layer. None of these mutate; auth.ts holds the
// mutex over write paths.

export function getUserById(userId: string): UserRecord | null {
  for (const u of users.values()) if (u.id === userId) return u;
  return null;
}

export function getUserByName(name: string): UserRecord | null {
  return users.get(normalizeUserKey(name)) ?? null;
}

export function hasOwner(): boolean {
  for (const u of users.values()) if (u.role === "owner") return true;
  return false;
}

export function countOwners(): number {
  let n = 0;
  for (const u of users.values()) if (u.role === "owner") n++;
  return n;
}

// True if deleting `userId` would leave the office without any owner record
// on disk. Used by the delete_user pre-check so a misclick can't lock the
// office out.
export function wouldDeleteLeaveNoOwner(userId: string): boolean {
  const target = getUserById(userId);
  if (!target || target.role !== "owner") return false;
  return countOwners() <= 1;
}

// ---------------------------------------------------------------------------
// Mutations used by the auth layer (invite acceptance, role promotion,
// owner-claim, evict-after-delete). These bypass the WS-coupled lifecycle in
// claimUser() below; they exist so auth.ts can mutate user records without
// inventing a synthetic ws handle. Caller is responsible for holding the
// auth mutex when ordering matters.

// Create-or-noop a user record for a freshly accepted invite. `opts.role`
// defaults to "member" if the office already has an owner; the first user
// claimed implicitly becomes owner. `opts.allowedRooms` defaults to [] for
// members and to the snapshot for owners — callers (auth.ts) pass the
// snapshot at first-owner time so the new owner sees every existing room.
export function claimUserByName(name: string, opts: { role?: UserRole; allowedRooms?: string[] } = {}): UserRecord {
  const trimmed = name.trim().slice(0, 64) || "Boss";
  const key = normalizeUserKey(trimmed);
  const existing = users.get(key);
  if (existing) return existing;
  const role: UserRole = opts.role ?? (users.size === 0 ? "owner" : "member");
  const id = generateUserId([...users.values()].map((u) => u.id));
  const allowedRooms = opts.allowedRooms ?? [];
  const created = createUserRecord({ id, name: trimmed, role, allowedRooms });
  users.set(key, created);
  persist();
  return created;
}

export function setUserRoleById(userId: string, role: UserRole): void {
  const target = getUserById(userId);
  if (!target) return;
  if (target.role === role) return;
  const key = normalizeUserKey(target.name);
  const next: UserRecord = { ...target, role };
  users.set(key, next);
  persist();
}

// Direct field update used by auth's bootstrap path. Validates allowedRooms
// only insofar as it must be a string[]; the bootstrap caller already
// snapshots from AgentManager so the values are known-good. Returns ok/err
// so the caller can propagate disk failures (auth's rollback closure needs
// to know whether to invoke).
export function updateUserById(userId: string, changes: UserRecordChanges): { ok: true; user: UserRecord } | { ok: false; error: string } {
  const target = getUserById(userId);
  if (!target) return { ok: false, error: `user ${userId} not found` };
  const next = applyBootstrapUserChanges(target, changes);
  users.delete(normalizeUserKey(target.name));
  users.set(normalizeUserKey(next.name), next);
  try {
    persist();
  } catch (err) {
    // Roll the in-memory state back so the caller can retry, then surface.
    users.delete(normalizeUserKey(next.name));
    users.set(normalizeUserKey(target.name), target);
    return { ok: false, error: (err as Error).message };
  }
  return { ok: true, user: next };
}

export function deleteUserById(userId: string): boolean {
  const target = getUserById(userId);
  if (!target) return false;
  users.delete(normalizeUserKey(target.name));
  persist();
  return true;
}

function ensureUserRooms(user: UserRecord, allRoomIds: string[]): UserRecord {
  const next = reconcileUserRooms(user, allRoomIds);
  if (next === user) return user;
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
    user = createUserRecord({ id, name, role, allowedRooms: allRoomIds });
    users.set(key, user);
    persist();
  }
  user = ensureUserRooms(user, allRoomIds);
  bindWsUser(ws, user);
  return user;
}

export function getWsUser(ws: import("bun").ServerWebSocket<unknown>): UserRecord | null {
  return getBoundWsUser(ws);
}

export function listUsers(rooms: RoomWire[]): UserRecord[] {
  const allRoomIds = rooms.map((r) => r.id);
  return [...users.values()].map((u) => ensureUserRooms(u, allRoomIds)).sort((a, b) => a.name.localeCompare(b.name));
}

/** First remaining office owner, optionally excluding a user about to be deleted. */
export function firstOfficeOwner(excludingUserId?: string): UserRecord | null {
  const owners = [...users.values()].filter((u) => u.role === "owner" && u.id !== excludingUserId).sort((a, b) => a.name.localeCompare(b.name));
  return owners[0] ?? null;
}

export function updateUser(actor: UserRecord | null, userId: string, changes: UserRecordChanges, rooms: RoomWire[]): UserRecord | null {
  if (!actor) return null;
  const target = [...users.values()].find((u) => u.id === userId);
  if (!target) return null;
  const canEdit = actor.role === "owner" || actor.id === target.id;
  if (!canEdit) return null;
  const allRoomIds = rooms.map((r) => r.id);
  const next = applyInteractiveUserChanges(target, actor, changes, allRoomIds);
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
