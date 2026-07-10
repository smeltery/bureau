import type { RoomWire, SessionContext, SessionWire, UserRecord, UserRole } from "../shared/types.ts";
import { loadUsers, saveUsers, normalizeUserKey, generateUserId } from "./persistence.ts";
import { defaultGhostColorForUserId, isGhostVariant, isHexColor, normalizeHexColor } from "../shared/avatar.ts";
import { normalizeAllowedRooms, reconcileUserRooms } from "./user-room-projection.ts";
export { projectAgents, projectRooms } from "./user-room-projection.ts";

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
  const created: UserRecord = {
    id,
    name: trimmed,
    role,
    envFile: null,
    memberPrompt: null,
    allowedRooms,
    hidden: [],
    order: [],
    defaultRoomId: allowedRooms[0] ?? null,
    notifRooms: [...allowedRooms],
    avatarColor: defaultGhostColorForUserId(id),
    avatarVariant: "classic",
    createdAt: Date.now(),
  };
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
export function updateUserById(
  userId: string,
  changes: Partial<Pick<UserRecord, "name" | "role" | "envFile" | "memberPrompt" | "allowedRooms" | "hidden" | "order" | "defaultRoomId" | "notifRooms" | "avatarColor" | "avatarVariant">>,
): { ok: true; user: UserRecord } | { ok: false; error: string } {
  const target = getUserById(userId);
  if (!target) return { ok: false, error: `user ${userId} not found` };
  const next: UserRecord = { ...target };
  if (typeof changes.name === "string") {
    const name = changes.name.trim().slice(0, 64);
    if (name) next.name = name;
  }
  if (changes.role === "owner" || changes.role === "member") next.role = changes.role;
  if (Array.isArray(changes.allowedRooms)) {
    next.allowedRooms = changes.allowedRooms.filter((id): id is string => typeof id === "string");
  }
  if (Array.isArray(changes.hidden)) {
    next.hidden = changes.hidden.filter((id): id is string => typeof id === "string");
  }
  if (Array.isArray(changes.order)) {
    next.order = changes.order.filter((id): id is string => typeof id === "string");
  }
  if (changes.defaultRoomId !== undefined) {
    next.defaultRoomId = typeof changes.defaultRoomId === "string" ? changes.defaultRoomId : null;
  }
  if (Array.isArray(changes.notifRooms)) {
    next.notifRooms = changes.notifRooms.filter((id): id is string => typeof id === "string" && next.allowedRooms.includes(id));
  }
  if (changes.envFile !== undefined) {
    const envFile = typeof changes.envFile === "string" ? changes.envFile.trim() : "";
    next.envFile = envFile || null;
  }
  if (changes.memberPrompt !== undefined) {
    const memberPrompt = typeof changes.memberPrompt === "string" ? changes.memberPrompt.trim() : "";
    next.memberPrompt = memberPrompt || null;
  }
  if (changes.avatarColor !== undefined && isHexColor(changes.avatarColor)) next.avatarColor = normalizeHexColor(changes.avatarColor);
  if (changes.avatarVariant !== undefined && isGhostVariant(changes.avatarVariant)) next.avatarVariant = changes.avatarVariant;
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
    user = {
      id,
      name,
      role,
      envFile: null,
      memberPrompt: null,
      allowedRooms: allRoomIds,
      hidden: [],
      order: [],
      defaultRoomId: allRoomIds[0] ?? null,
      notifRooms: [...allRoomIds],
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

// Replace the random per-WS session prefix with the authoritative
// auth-session prefix so the UI's "this is my row" check in the Access pane
// uses the actual session id. Called from the WS-open path right after
// claimUser binds the auth-session's user. No-op for loopback connections
// that arrive without a session.
export function setWsSessionPrefix(ws: import("bun").ServerWebSocket<unknown>, prefix: string) {
  if (prefix) sessionPrefixes.set(ws, prefix);
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
  changes: Partial<Pick<UserRecord, "name" | "role" | "envFile" | "memberPrompt" | "allowedRooms" | "hidden" | "order" | "defaultRoomId" | "notifRooms" | "avatarColor" | "avatarVariant">>,
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
  const accessRooms = next.role === "owner" ? allRoomIds : next.allowedRooms;
  if (Array.isArray(changes.hidden)) {
    next.hidden = changes.hidden.filter((id): id is string => typeof id === "string" && accessRooms.includes(id));
  } else {
    next.hidden = (next.hidden ?? []).filter((id) => accessRooms.includes(id));
  }
  if (Array.isArray(changes.order)) {
    const seen = new Set<string>();
    next.order = changes.order.filter((id): id is string => {
      if (typeof id !== "string" || !accessRooms.includes(id) || seen.has(id)) return false;
      seen.add(id);
      return true;
    });
  } else {
    next.order = (next.order ?? []).filter((id) => accessRooms.includes(id));
  }
  const hiddenSet = new Set(next.hidden);
  const shownRooms = accessRooms.filter((id) => !hiddenSet.has(id));
  if (changes.defaultRoomId !== undefined) {
    next.defaultRoomId = typeof changes.defaultRoomId === "string" && shownRooms.includes(changes.defaultRoomId) ? changes.defaultRoomId : null;
  } else if (next.defaultRoomId && !shownRooms.includes(next.defaultRoomId)) {
    next.defaultRoomId = shownRooms[0] ?? null;
  }
  // notifRooms is a self-editable preference (owner or self, already gated by
  // canEdit above). Keep it within the rooms the user can actually see.
  if (Array.isArray(changes.notifRooms)) {
    next.notifRooms = changes.notifRooms.filter((id): id is string => typeof id === "string" && shownRooms.includes(id));
  }
  if (changes.envFile !== undefined) {
    const envFile = typeof changes.envFile === "string" ? changes.envFile.trim() : "";
    next.envFile = envFile || null;
  }
  if (changes.memberPrompt !== undefined) {
    const memberPrompt = typeof changes.memberPrompt === "string" ? changes.memberPrompt.trim() : "";
    next.memberPrompt = memberPrompt || null;
  }
  if (changes.avatarColor !== undefined && isHexColor(changes.avatarColor)) next.avatarColor = normalizeHexColor(changes.avatarColor);
  if (changes.avatarVariant !== undefined && isGhostVariant(changes.avatarVariant)) next.avatarVariant = changes.avatarVariant;
  if (next.role === "owner" && next.allowedRooms.length === 0) next.allowedRooms = allRoomIds;
  // Drop any notifRooms that fell outside a shrunken shown-room set.
  next.notifRooms = next.notifRooms.filter((id) => shownRooms.includes(id));
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
