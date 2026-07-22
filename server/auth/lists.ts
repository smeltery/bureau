import type { InviteWire, SessionWire } from "../../shared/types.ts";
import { lowercaseKey } from "../../shared/identity.ts";
import { getUserById } from "../users.ts";
import { ensureLoaded, inviteStore, sessionStore, type StoredInvite, type StoredSession } from "./store.ts";

function toInviteWire(v: StoredInvite): InviteWire {
  return {
    tokenPrefix: v.tokenPrefix,
    username: v.username,
    role: v.role,
    createdBy: v.createdBy,
    createdAt: v.createdAt,
    expiresAt: v.expiresAt,
    ...(v.allowedRooms ? { allowedRooms: v.allowedRooms } : {}),
    ...(v.bootstrap ? { bootstrap: true as const } : {}),
  };
}

function toSessionWire(v: StoredSession): SessionWire {
  const user = getUserById(v.userId);
  return {
    sessionPrefix: v.sessionPrefix,
    userId: v.userId,
    username: user?.name ?? "(deleted)",
    createdAt: v.createdAt,
    lastSeenAt: v.lastSeenAt,
    expiresAt: v.expiresAt,
    absoluteExpiresAt: v.absoluteExpiresAt,
    userAgent: v.userAgent,
  };
}

export function listInvites(): InviteWire[] {
  ensureLoaded();
  const now = Date.now();
  const result: InviteWire[] = [];
  for (const v of inviteStore().values()) {
    if (v.consumed) continue;
    if (v.expiresAt < now) continue;
    result.push(toInviteWire(v));
  }
  return result.sort((a, b) => b.createdAt - a.createdAt);
}

export function listInvitesForUsername(name: string): InviteWire[] {
  ensureLoaded();
  const now = Date.now();
  const target = lowercaseKey(name);
  const result: InviteWire[] = [];
  for (const v of inviteStore().values()) {
    if (v.consumed) continue;
    if (v.expiresAt < now) continue;
    if (!v.username || lowercaseKey(v.username) !== target) continue;
    result.push(toInviteWire(v));
  }
  return result.sort((a, b) => b.createdAt - a.createdAt);
}

export function listActiveSessions(): SessionWire[] {
  ensureLoaded();
  const now = Date.now();
  const result: SessionWire[] = [];
  for (const v of sessionStore().values()) {
    if (v.expiresAt < now || v.absoluteExpiresAt < now) continue;
    result.push(toSessionWire(v));
  }
  return result.sort((a, b) => b.lastSeenAt - a.lastSeenAt);
}

export function listActiveSessionsForUserId(userId: string): SessionWire[] {
  ensureLoaded();
  const now = Date.now();
  const result: SessionWire[] = [];
  for (const v of sessionStore().values()) {
    if (v.expiresAt < now || v.absoluteExpiresAt < now) continue;
    if (v.userId !== userId) continue;
    result.push(toSessionWire(v));
  }
  return result.sort((a, b) => b.lastSeenAt - a.lastSeenAt);
}
