import { existsSync, readFileSync } from "fs";
import type { UserRole } from "../../shared/types.ts";
import { atomicWriteFileSync, INVITES_FILE, SESSIONS_FILE } from "../persistence/paths.ts";

export interface StoredInvite {
  tokenHash: string;
  tokenPrefix: string;
  username: string | null;
  role: UserRole;
  createdBy: string | null;
  createdAt: number;
  expiresAt: number;
  consumed: boolean;
  consumedAt: number | null;
  bootstrap: boolean;
  allowedRooms?: string[];
  // The member this link signs in. Absent only on bootstrap invites and on
  // legacy rows minted before members were created up front.
  userId?: string;
}

export interface StoredSession {
  sessionIdHash: string;
  sessionPrefix: string;
  userId: string;
  createdAt: number;
  lastSeenAt: number;
  expiresAt: number;
  absoluteExpiresAt: number;
  userAgent: string | null;
}

let invites: Map<string, StoredInvite> | null = null;
let sessions: Map<string, StoredSession> | null = null;
let mutexTail: Promise<unknown> = Promise.resolve();

export function mutate<T>(fn: () => Promise<T> | T): Promise<T> {
  const run = mutexTail.then(() => fn());
  mutexTail = run.catch(() => undefined);
  return run;
}

export function ensureLoaded() {
  if (invites === null) invites = loadInvitesFromDisk();
  if (sessions === null) sessions = loadSessionsFromDisk();
}

export function inviteStore(): Map<string, StoredInvite> {
  ensureLoaded();
  return invites!;
}

export function sessionStore(): Map<string, StoredSession> {
  ensureLoaded();
  return sessions!;
}

function loadInvitesFromDisk(): Map<string, StoredInvite> {
  const map = new Map<string, StoredInvite>();
  try {
    if (!existsSync(INVITES_FILE)) return map;
    const raw = readFileSync(INVITES_FILE, "utf-8");
    if (!raw.trim()) return map;
    const parsed = JSON.parse(raw) as Record<string, StoredInvite>;
    for (const [k, v] of Object.entries(parsed)) {
      if (!v || typeof v.tokenHash !== "string") continue;
      map.set(k, v);
    }
  } catch (err) {
    console.error("Failed to load invites.json:", err);
  }
  return map;
}

function loadSessionsFromDisk(): Map<string, StoredSession> {
  const map = new Map<string, StoredSession>();
  try {
    if (!existsSync(SESSIONS_FILE)) return map;
    const raw = readFileSync(SESSIONS_FILE, "utf-8");
    if (!raw.trim()) return map;
    const parsed = JSON.parse(raw) as Record<string, Partial<StoredSession>>;
    for (const [k, v] of Object.entries(parsed)) {
      if (!v || typeof v.sessionIdHash !== "string") continue;
      if (typeof v.userId !== "string" || !v.userId) continue;
      map.set(k, {
        sessionIdHash: v.sessionIdHash,
        sessionPrefix: v.sessionPrefix ?? "",
        userId: v.userId,
        createdAt: v.createdAt ?? Date.now(),
        lastSeenAt: v.lastSeenAt ?? Date.now(),
        expiresAt: v.expiresAt ?? 0,
        absoluteExpiresAt: v.absoluteExpiresAt ?? 0,
        userAgent: v.userAgent ?? null,
      });
    }
  } catch (err) {
    console.error("Failed to load sessions.json:", err);
  }
  return map;
}

export function persistInvites() {
  if (!invites) return;
  const obj: Record<string, StoredInvite> = {};
  for (const [k, v] of invites) obj[k] = v;
  atomicWriteFileSync(INVITES_FILE, JSON.stringify(obj, null, 2));
}

export function persistSessions() {
  if (!sessions) return;
  const obj: Record<string, StoredSession> = {};
  for (const [k, v] of sessions) obj[k] = v;
  atomicWriteFileSync(SESSIONS_FILE, JSON.stringify(obj, null, 2));
}
