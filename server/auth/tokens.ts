import { createHash, randomBytes, timingSafeEqual } from "crypto";

const TOKEN_BYTES = 32;
const PREFIX_LEN = 8;

export function randomToken(): { raw: string; hash: string; prefix: string } {
  const buf = randomBytes(TOKEN_BYTES);
  const raw = buf.toString("base64url");
  const hash = hashOf(raw);
  return { raw, hash, prefix: raw.slice(0, PREFIX_LEN) };
}

export function hashOf(rawToken: string): string {
  return createHash("sha256").update(rawToken).digest("hex");
}

export function safeHashEq(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

export function safePrefix(rawToken: string): string {
  return rawToken.slice(0, PREFIX_LEN);
}
