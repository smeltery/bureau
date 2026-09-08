import { createHash, randomBytes, timingSafeEqual } from "crypto";
import { existsSync, readFileSync } from "fs";
import type { ApiTokenInboxDrainRes, ApiTokenInboxMessage, ApiTokenLogEntry, ApiTokenWire } from "../../shared/types.ts";
import { API_TOKENS_FILE, atomicWriteFileSync } from "../persistence/paths.ts";
import { getUserById } from "../users.ts";
import { appendTokenLog, migrateLegacyInbox, readTokenLogAfter, refreshTokenLog, type LegacyInboxMessage, _testResetApiTokenLogs } from "./api-token-log.ts";

const RAW_PREFIX = "bureau_pat_";
export const API_TOKEN_EXPIRY_DAYS = [30, 365, null] as const;
export const DEFAULT_API_TOKEN_EXPIRY_DAYS = 30;
const LAST_USED_PERSIST_INTERVAL_MS = 60_000;

interface StoredApiToken extends ApiTokenWire {
  userId: string;
  tokenHash: string;
  lastSequence: number;
  lastDrainedAt: number | null;
  inbox?: LegacyInboxMessage[];
}

export interface ResolvedApiToken {
  userId: string;
  username: string;
  role: "owner" | "member";
  tokenId: string;
  tokenName: string;
}

let tokens: Map<string, StoredApiToken> | null = null;
let hashIndex: Map<string, string> | null = null;
let lastUsedPersistedAt = new Map<string, number>();
let mutexTail: Promise<unknown> = Promise.resolve();

function mutate<T>(fn: () => T | Promise<T>): Promise<T> {
  const run = mutexTail.then(() => fn());
  mutexTail = run.catch(() => undefined);
  return run;
}

function hashOf(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}

function safeHashEq(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

function validLegacyInboxMessage(value: unknown): value is LegacyInboxMessage {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const message = value as Partial<LegacyInboxMessage>;
  return (
    typeof message.id === "string" &&
    typeof message.sentAt === "number" &&
    typeof message.text === "string" &&
    typeof message.senderAgentId === "string" &&
    typeof message.senderAgentName === "string" &&
    typeof message.senderRoomName === "string" &&
    (message.sequence === undefined || (Number.isSafeInteger(message.sequence) && message.sequence > 0))
  );
}

function ensureLoaded(): void {
  if (tokens && hashIndex) return;
  tokens = new Map();
  hashIndex = new Map();
  lastUsedPersistedAt = new Map();
  try {
    if (!existsSync(API_TOKENS_FILE)) return;
    const raw = readFileSync(API_TOKENS_FILE, "utf-8");
    if (!raw.trim()) return;
    const parsed = JSON.parse(raw) as Record<string, Partial<StoredApiToken> & { inbox?: unknown }>;
    let migrated = false;
    for (const [id, value] of Object.entries(parsed)) {
      if (value.id !== id || typeof value.userId !== "string" || typeof value.name !== "string" || typeof value.tokenPrefix !== "string" || typeof value.tokenHash !== "string") continue;
      if (typeof value.createdAt !== "number" || (typeof value.expiresAt !== "number" && value.expiresAt !== null)) continue;
      const inbox = Array.isArray(value.inbox) && value.inbox.every(validLegacyInboxMessage) ? value.inbox : [];
      const seeded = Number.isSafeInteger(value.lastSequence) && (value.lastSequence as number) >= 0 ? (value.lastSequence as number) : 0;
      const { lastSequence, failed } = migrateLegacyInbox(id, inbox, seeded);
      if (!failed && (value.inbox !== undefined || lastSequence !== value.lastSequence)) migrated = true;
      const record: StoredApiToken = {
        id,
        userId: value.userId,
        name: value.name,
        tokenPrefix: value.tokenPrefix,
        tokenHash: value.tokenHash,
        createdAt: value.createdAt,
        expiresAt: value.expiresAt,
        lastUsedAt: typeof value.lastUsedAt === "number" ? value.lastUsedAt : null,
        lastSequence,
        ...(failed && inbox.length ? { inbox } : {}),
        lastDrainedAt: typeof value.lastDrainedAt === "number" || value.lastDrainedAt === null ? value.lastDrainedAt : null,
      };
      tokens.set(id, record);
      hashIndex.set(record.tokenHash, id);
      lastUsedPersistedAt.set(id, record.lastUsedAt ?? 0);
    }
    if (migrated) {
      try {
        persist();
      } catch (err) {
        console.error("[auth] could not save API token migration:", err);
      }
    }
  } catch (err) {
    console.error("[auth] failed to load api-tokens.json:", err);
  }
}

function persist(): void {
  ensureLoaded();
  const out: Record<string, StoredApiToken> = {};
  for (const [id, record] of tokens!) {
    if (record.inbox?.length) out[id] = record;
    else {
      const { inbox: _ignored, ...rest } = record;
      out[id] = rest;
    }
  }
  atomicWriteFileSync(API_TOKENS_FILE, JSON.stringify(out, null, 2));
}

function wire(record: StoredApiToken): ApiTokenWire {
  return {
    id: record.id,
    name: record.name,
    tokenPrefix: record.tokenPrefix,
    createdAt: record.createdAt,
    expiresAt: record.expiresAt,
    lastUsedAt: record.lastUsedAt,
  };
}

export function listApiTokens(userId: string): ApiTokenWire[] {
  ensureLoaded();
  return [...tokens!.values()]
    .filter((record) => record.userId === userId)
    .sort((a, b) => b.createdAt - a.createdAt)
    .map(wire);
}

export async function mintApiToken(input: { userId: string; name: string; expiresInDays: number | null; now?: number }): Promise<{ token: string; apiToken: ApiTokenWire }> {
  return mutate(() => {
    ensureLoaded();
    const now = input.now ?? Date.now();
    const token = `${RAW_PREFIX}${randomBytes(32).toString("base64url")}`;
    const tokenHash = hashOf(token);
    let id: string;
    do {
      id = randomBytes(8).toString("hex");
    } while (tokens!.has(id));
    const record: StoredApiToken = {
      id,
      userId: input.userId,
      name: input.name,
      tokenPrefix: token.slice(0, RAW_PREFIX.length + 8),
      tokenHash,
      createdAt: now,
      expiresAt: input.expiresInDays === null ? null : now + input.expiresInDays * 24 * 60 * 60 * 1000,
      lastUsedAt: null,
      lastSequence: 0,
      lastDrainedAt: null,
    };
    tokens!.set(id, record);
    hashIndex!.set(tokenHash, id);
    try {
      persist();
    } catch (err) {
      tokens!.delete(id);
      hashIndex!.delete(tokenHash);
      throw err;
    }
    return { token, apiToken: wire(record) };
  });
}

function isLive(record: StoredApiToken, now: number): boolean {
  return record.expiresAt === null || record.expiresAt > now;
}

function commitEntry(record: StoredApiToken, entry: ApiTokenLogEntry): void {
  refreshTokenLog(record.id);
  entry.sequence = record.lastSequence + 1;
  appendTokenLog(record.id, entry);
  record.lastSequence = entry.sequence;
  persist();
}

export async function enqueueApiTokenInboxMessage(input: {
  tokenId: string;
  userId: string;
  text: string;
  senderAgentId: string;
  senderAgentName: string;
  senderRoomName: string;
  now?: number;
}): Promise<{ ok: true; message: ApiTokenInboxMessage; lastDrainedAt: number | null; tokenName: string } | { ok: false; reason: "unavailable" }> {
  return mutate(() => {
    ensureLoaded();
    const now = input.now ?? Date.now();
    const record = tokens!.get(input.tokenId);
    if (!record || record.userId !== input.userId || !isLive(record, now)) {
      return { ok: false as const, reason: "unavailable" as const };
    }
    const message: ApiTokenInboxMessage = {
      direction: "from_agent",
      sequence: record.lastSequence + 1,
      id: randomBytes(8).toString("hex"),
      sentAt: now,
      text: input.text,
      senderAgentId: input.senderAgentId,
      senderAgentName: input.senderAgentName,
      senderRoomName: input.senderRoomName,
    };
    commitEntry(record, message);
    return { ok: true as const, message, lastDrainedAt: record.lastDrainedAt, tokenName: record.name };
  });
}

export async function sendApiTokenMessage(
  tokenId: string,
  target: { targetAgentId: string; targetAgentName: string; targetRoomName: string; text: string },
  send: () => { ok: true } | { ok: false; status: number; error: string },
): Promise<{ ok: true; messageId: string } | { ok: false; status: number; error: string }> {
  return mutate(() => {
    ensureLoaded();
    const record = tokens!.get(tokenId);
    if (!record || !isLive(record, Date.now())) {
      return { ok: false as const, status: 404, error: "api token unavailable" };
    }
    const result = send();
    if (!result.ok) return result;
    const id = randomBytes(8).toString("hex");
    commitEntry(record, {
      direction: "to_agent",
      sequence: record.lastSequence + 1,
      id,
      sentAt: Date.now(),
      text: target.text,
      targetAgentId: target.targetAgentId,
      targetAgentName: target.targetAgentName,
      targetRoomName: target.targetRoomName,
    });
    return { ok: true as const, messageId: id };
  });
}

export async function drainApiTokenInbox(tokenId: string, now = Date.now(), after = 0): Promise<ApiTokenInboxDrainRes | null> {
  return mutate(() => {
    ensureLoaded();
    const record = tokens!.get(tokenId);
    if (!record || !isLive(record, now)) return null;
    const { entries, firstSequence, latestHint } = readTokenLogAfter(tokenId, after);
    record.lastSequence = Math.max(record.lastSequence, latestHint.tailSequence);
    const previouslyDrainedAt = record.lastDrainedAt;
    record.lastDrainedAt = now;
    try {
      persist();
    } catch (err) {
      record.lastDrainedAt = previouslyDrainedAt;
      throw err;
    }
    return {
      entries,
      firstSequence: firstSequence || record.lastSequence,
      latestSequence: record.lastSequence,
      previouslyDrainedAt,
      drainedAt: now,
    };
  });
}

export async function revokeApiToken(userId: string, id: string): Promise<boolean> {
  return mutate(() => {
    ensureLoaded();
    const record = tokens!.get(id);
    if (!record || record.userId !== userId) return false;
    tokens!.delete(id);
    hashIndex!.delete(record.tokenHash);
    lastUsedPersistedAt.delete(id);
    persist();
    return true;
  });
}

export function resolveApiToken(raw: string | null, now = Date.now()): ResolvedApiToken | null {
  if (!raw?.startsWith(RAW_PREFIX)) return null;
  ensureLoaded();
  const tokenHash = hashOf(raw);
  const id = hashIndex!.get(tokenHash);
  if (!id) return null;
  const record = tokens!.get(id);
  if (!record || !safeHashEq(record.tokenHash, tokenHash)) return null;
  if (record.expiresAt !== null && record.expiresAt <= now) return null;
  const user = getUserById(record.userId);
  if (!user) return null;
  record.lastUsedAt = now;
  const lastPersist = lastUsedPersistedAt.get(id) ?? 0;
  if (now - lastPersist >= LAST_USED_PERSIST_INTERVAL_MS) {
    try {
      persist();
      lastUsedPersistedAt.set(id, now);
    } catch (err) {
      console.error("[auth] failed to persist API token last-used time:", err);
    }
  }
  return { userId: user.id, username: user.name, role: user.role, tokenId: id, tokenName: record.name };
}

export function _testResetApiTokens(): void {
  tokens = null;
  hashIndex = null;
  lastUsedPersistedAt = new Map();
  mutexTail = Promise.resolve();
  _testResetApiTokenLogs();
}
