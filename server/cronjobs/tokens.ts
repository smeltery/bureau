import { createHash, randomBytes, timingSafeEqual } from "crypto";

const TOKEN_BYTES = 32;

interface StoredRunToken {
  hash: string;
  raw: string;
  cronjobId: string;
  runId: string;
  userId: string | null;
}

const byRunId = new Map<string, StoredRunToken>();
const runIdByHash = new Map<string, string>();

function hashToken(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}

function safeHashEq(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

export function mintRunToken(cronjobId: string, runId: string, userId: string | null): string {
  revokeRunToken(runId);
  const raw = randomBytes(TOKEN_BYTES).toString("base64url");
  const hash = hashToken(raw);
  byRunId.set(runId, { hash, raw, cronjobId, runId, userId });
  runIdByHash.set(hash, runId);
  return raw;
}

export function revokeRunToken(runId: string): void {
  const existing = byRunId.get(runId);
  if (!existing) return;
  runIdByHash.delete(existing.hash);
  byRunId.delete(runId);
}

export function resolveRunToken(raw: string | null): { cronjobId: string; runId: string; userId: string | null } | null {
  if (!raw) return null;
  const hash = hashToken(raw);
  const runId = runIdByHash.get(hash);
  if (!runId) return null;
  const stored = byRunId.get(runId);
  if (!stored || !safeHashEq(stored.hash, hash)) return null;
  return { cronjobId: stored.cronjobId, runId: stored.runId, userId: stored.userId };
}

export function getRunToken(runId: string): string | null {
  return byRunId.get(runId)?.raw ?? null;
}

export function _testResetRunTokens(): void {
  byRunId.clear();
  runIdByHash.clear();
}
