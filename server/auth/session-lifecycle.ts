import { getUserById } from "../users.ts";
import { fireSessionsChangedHook, setOnSessionsChanged } from "./session-events.ts";
import { forceExpireSocketsForSession } from "./session-sockets.ts";
import { ensureLoaded, mutate, persistSessions, sessionStore } from "./store.ts";
export { setOnSessionsChanged };
export { revalidateByHash, sessionContextFor, validateSession, type SessionLookup } from "./session-validation.ts";

export type SessionRevokeResult = "ok" | "not_found" | "ambiguous";

export async function revokeSessionByPrefix(prefix: string): Promise<SessionRevokeResult> {
  return mutate(() => {
    ensureLoaded();
    const matches: string[] = [];
    for (const [k, v] of sessionStore()) {
      if (v.sessionPrefix === prefix) matches.push(k);
      if (matches.length > 1) break;
    }
    if (matches.length === 0) return "not_found";
    if (matches.length > 1) return "ambiguous";
    const hash = matches[0];
    const prev = sessionStore().get(hash)!;
    sessionStore().delete(hash);
    try {
      persistSessions();
    } catch (err) {
      sessionStore().set(hash, prev);
      throw err;
    }
    forceExpireSocketsForSession(hash);
    fireSessionsChangedHook();
    return "ok";
  });
}

export async function logoutBySessionHash(sessionIdHash: string): Promise<boolean> {
  return mutate(() => {
    ensureLoaded();
    const prev = sessionStore().get(sessionIdHash);
    if (!prev) return false;
    sessionStore().delete(sessionIdHash);
    try {
      persistSessions();
    } catch (err) {
      sessionStore().set(sessionIdHash, prev);
      throw err;
    }
    forceExpireSocketsForSession(sessionIdHash);
    fireSessionsChangedHook();
    return true;
  });
}

// Evict all active sessions belonging to a user. Called by delete_user so
// the deleted user's open tabs land on the login wall.
export async function evictSessionsForUserId(userId: string): Promise<number> {
  return mutate(() => {
    ensureLoaded();
    const hashes: string[] = [];
    for (const [hash, s] of sessionStore()) {
      if (s.userId === userId) hashes.push(hash);
    }
    if (hashes.length === 0) return 0;
    for (const hash of hashes) sessionStore().delete(hash);
    try {
      persistSessions();
    } catch (err) {
      console.error(`[auth] evictSessionsForUserId persist failed (userId=${userId}, count=${hashes.length}):`, err);
    }
    for (const hash of hashes) forceExpireSocketsForSession(hash);
    fireSessionsChangedHook();
    return hashes.length;
  });
}

export type ScopedSessionRevokeResult = SessionRevokeResult | "would_strand_office";

export async function revokeActiveSessionByPrefixForUserId(prefix: string, userId: string): Promise<ScopedSessionRevokeResult> {
  return mutate(() => {
    ensureLoaded();
    const now = Date.now();
    const matches: string[] = [];
    for (const [k, v] of sessionStore()) {
      if (v.sessionPrefix !== prefix) continue;
      if (v.expiresAt < now || v.absoluteExpiresAt < now) continue;
      matches.push(k);
      if (matches.length > 1) break;
    }
    if (matches.length === 0) return "not_found";
    if (matches.length > 1) return "ambiguous";
    const hash = matches[0];
    const row = sessionStore().get(hash)!;
    if (row.userId !== userId) return "not_found";
    // Confidentiality-critical: this check is *after* the scope test so a
    // foreign last-owner prefix can never produce a divergent response.
    if (wouldRevokeLeaveOfficeUnreachable(hash)) {
      return "would_strand_office";
    }
    sessionStore().delete(hash);
    try {
      persistSessions();
    } catch (err) {
      sessionStore().set(hash, row);
      throw err;
    }
    forceExpireSocketsForSession(hash);
    fireSessionsChangedHook();
    return "ok";
  });
}

// ---------------------------------------------------------------------------
// Lockout-prevention helpers
//
// The invariant: the office must always retain at least one owner-role
// user with at least one active session, so an operator can recover from
// inside the browser.

export function countActiveOwnerSessions(): number {
  ensureLoaded();
  const now = Date.now();
  let n = 0;
  for (const s of sessionStore().values()) {
    if (s.expiresAt < now || s.absoluteExpiresAt < now) continue;
    const u = getUserById(s.userId);
    if (u?.role === "owner") n++;
  }
  return n;
}

export function wouldRevokeLeaveOfficeUnreachable(sessionIdHash: string): boolean {
  ensureLoaded();
  const target = sessionStore().get(sessionIdHash);
  if (!target) return false;
  const targetUser = getUserById(target.userId);
  if (targetUser?.role !== "owner") return false;
  const now = Date.now();
  for (const [hash, s] of sessionStore()) {
    if (hash === sessionIdHash) continue;
    if (s.expiresAt < now || s.absoluteExpiresAt < now) continue;
    const u = getUserById(s.userId);
    if (u?.role === "owner") return false;
  }
  return true;
}

export function resolveSessionHashByPrefix(prefix: string): string | null {
  ensureLoaded();
  let found: string | null = null;
  for (const [hash, s] of sessionStore()) {
    if (s.sessionPrefix === prefix) {
      if (found !== null) return null; // ambiguous
      found = hash;
    }
  }
  return found;
}
