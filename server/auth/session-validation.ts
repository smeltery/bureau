import type { SessionContext, UserRole } from "../../shared/types.ts";
import { getUserById } from "../users.ts";
import { fireSessionsChangedHook } from "./session-events.ts";
import { forceExpireSocketsForSession } from "./session-sockets.ts";
import { ensureLoaded, persistSessions, sessionStore } from "./store.ts";
import { hashOf, safeHashEq } from "./tokens.ts";

export interface SessionLookup {
  sessionIdHash: string;
  sessionPrefix: string;
  userId: string;
  username: string;
  role: UserRole;
  needsRolling: boolean;
  // The session's ABSOLUTE cap (not the rolling expiresAt), so a caller
  // re-issuing the cookie under a different name anchors Max-Age to the same
  // moment the original cookie was anchored to — a migration must never
  // extend a session's life.
  absoluteExpiresAt: number;
}

let lastPersist = 0;
const PERSIST_THROTTLE_MS = 30_000;

export function validateSession(rawCookie: string | null): SessionLookup | null {
  if (!rawCookie) return null;
  ensureLoaded();
  const hash = hashOf(rawCookie);
  return validateByHash(hash);
}

export function revalidateByHash(sessionIdHash: string): SessionLookup | null {
  ensureLoaded();
  return validateByHash(sessionIdHash);
}

export function sessionContextFor(lookup: SessionLookup, connectionId: string): SessionContext {
  return {
    userId: lookup.userId,
    username: lookup.username,
    role: lookup.role,
    currentSessionPrefix: lookup.sessionPrefix,
    connectionId,
  };
}

function validateByHash(hash: string): SessionLookup | null {
  const session = sessionStore().get(hash);
  if (!session) return null;
  if (!safeHashEq(session.sessionIdHash, hash)) return null;
  const now = Date.now();
  if (session.expiresAt < now || session.absoluteExpiresAt < now) {
    sessionStore().delete(hash);
    forceExpireSocketsForSession(hash);
    fireSessionsChangedHook();
    return null;
  }
  const user = getUserById(session.userId);
  if (!user) {
    sessionStore().delete(hash);
    forceExpireSocketsForSession(hash);
    fireSessionsChangedHook();
    return null;
  }
  const rollingTtlMs = 30 * 24 * 60 * 60 * 1000;
  const newExpires = Math.min(now + rollingTtlMs, session.absoluteExpiresAt);
  let needsRolling = false;
  if (newExpires > session.expiresAt + 60_000) {
    session.expiresAt = newExpires;
    needsRolling = true;
  }
  session.lastSeenAt = now;
  if (now - lastPersist > PERSIST_THROTTLE_MS) {
    lastPersist = now;
    try {
      persistSessions();
    } catch (err) {
      console.error("[auth] throttled sessions persist failed:", err);
    }
  }
  return {
    sessionIdHash: hash,
    sessionPrefix: session.sessionPrefix,
    userId: user.id,
    username: user.name,
    role: user.role,
    needsRolling,
    absoluteExpiresAt: session.absoluteExpiresAt,
  };
}
