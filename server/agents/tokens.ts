import { createHash, randomBytes, timingSafeEqual } from "crypto";

const TOKEN_BYTES = 32;

interface StoredAgentToken {
  hash: string;
  raw: string;
  userId: string | null;
}

const byAgentId = new Map<string, StoredAgentToken>();
const agentIdByHash = new Map<string, string>();

function newToken(): { raw: string; hash: string } {
  const raw = randomBytes(TOKEN_BYTES).toString("base64url");
  const hash = hashToken(raw);
  return { raw, hash };
}

function hashToken(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}

function safeHashEq(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

export function mintAgentToken(agentId: string, userId: string | null): string {
  revokeAgentToken(agentId);
  const { raw, hash } = newToken();
  byAgentId.set(agentId, { hash, raw, userId });
  agentIdByHash.set(hash, agentId);
  return raw;
}

export function getAgentToken(agentId: string): string | null {
  return byAgentId.get(agentId)?.raw ?? null;
}

export function revokeAgentToken(agentId: string): void {
  const existing = byAgentId.get(agentId);
  if (!existing) return;
  agentIdByHash.delete(existing.hash);
  byAgentId.delete(agentId);
}

export function readBearerToken(req: Request): string | null {
  const header = req.headers.get("authorization");
  if (!header) return null;
  const match = /^bearer[ \t]+(.+)$/i.exec(header.trim());
  if (!match) return null;
  const token = match[1].trim();
  return token.length ? token : null;
}

export function resolveAgentToken(raw: string | null): { agentId: string; userId: string | null } | null {
  if (!raw) return null;
  const hash = hashToken(raw);
  const agentId = agentIdByHash.get(hash);
  if (!agentId) return null;
  const stored = byAgentId.get(agentId);
  if (!stored || !safeHashEq(stored.hash, hash)) return null;
  return { agentId, userId: stored.userId };
}

export function redactAgentTokens(text: string): string {
  let out = text;
  for (const token of byAgentId.values()) {
    if (token.raw && out.includes(token.raw)) out = out.split(token.raw).join("[redacted-token]");
  }
  return out;
}

export function _testResetAgentTokens(): void {
  byAgentId.clear();
  agentIdByHash.clear();
}
