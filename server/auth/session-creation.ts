import { randomToken } from "./tokens.ts";
import type { StoredSession } from "./store.ts";

const ROLLING_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const ABSOLUTE_TTL_MS = 365 * 24 * 60 * 60 * 1000;

export interface CreatedSession {
  rawSessionId: string;
  sessionHash: string;
  session: StoredSession;
}

export function createSessionForUser(userId: string, userAgent: string | null): CreatedSession {
  const { raw: rawSessionId, hash: sessionHash, prefix } = randomToken();
  const now = Date.now();
  const session: StoredSession = {
    sessionIdHash: sessionHash,
    sessionPrefix: prefix,
    userId,
    createdAt: now,
    lastSeenAt: now,
    expiresAt: now + ROLLING_TTL_MS,
    absoluteExpiresAt: now + ABSOLUTE_TTL_MS,
    userAgent,
  };
  return { rawSessionId, sessionHash, session };
}
