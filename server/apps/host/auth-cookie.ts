// The app-scoped cookie, and the constants the whole handshake is measured in.
//
// Consumed by server/apps/host/auth.ts (the handshake itself), its store
// (auth-store.ts), and server/apps/host/dispatch.ts, which
// needs APP_RESERVED_PATH and APP_AUTH_PATH to keep the reserved namespace out
// of an app's reach.
//
// THE PROPERTY THIS FILE EXISTS FOR: the app-scoped cookie must not be
// forgeable from an app origin, and an app origin must never be able to read or
// mint an OFFICE session. Both follow from the two rules below —
//
//   - the cookie carries the `__Host-` prefix, which is browser-enforced
//     (Secure, Path=/, no Domain attribute). A page on a sibling app hostname
//     therefore cannot write a cookie this host will read: without the prefix's
//     attributes the browser drops it, and with them it is host-only, so it
//     lands on the writer's own hostname and nowhere else;
//   - the cookie's VALUE is a 256-bit random token that only ever exists in
//     this process's table (hashed) and in the browser. It is not derived from
//     anything an app can compute, and it is not an office credential: it names
//     a row that points at an office session, and the office session — never
//     this cookie — is the source of truth on every request.
//
// The other direction is closed by omission and deliberately so: this reader
// knows ONE name, and it is not an office cookie name. Nothing on the app-host
// arm reads `bureau_session` / `__Host-bureau_session` (those are host-only to
// the office host and never reach an app hostname anyway), and nothing on this
// arm can write one.

import { createHash, randomBytes, timingSafeEqual } from "crypto";

// --- routes -----------------------------------------------------------------

// The prefix reserved on every app hostname. An app can never serve or shadow
// anything under it; the relay plugs in BELOW that check. Exported from here so
// the dispatcher and the handshake cannot disagree about where the boundary is.
export const APP_RESERVED_PATH = "/__bureau";

// The app-host route the handshake lands on, inside the reserved prefix.
export const APP_AUTH_PATH = `${APP_RESERVED_PATH}/auth`;

// The office route that mints a code. Behind the office's ordinary auth wall,
// so an unauthenticated visitor meets the normal login page here.
export const APP_MINT_PATH = "/auth/app";

// --- the cookie -------------------------------------------------------------

// `__Host-` is browser-enforced: Secure, Path=/, and no Domain attribute, which
// makes it host-only in a way a sibling app cannot override. One name serves
// every app because host-only cookies of the same name on different hostnames
// are different cookies — and the record behind it names its app anyway, so a
// cookie that somehow arrived at the wrong host still fails.
export const APP_COOKIE_NAME = "__Host-bureau_app";

// --- lifetimes and budgets --------------------------------------------------

// Code lifetime: long enough for a browser to follow two redirects on a slow
// phone, short enough that a code copied out of a history entry or a proxy log
// is dead before anyone reads it.
export const APP_CODE_TTL_MS = 45_000;

// How long an app session lasts before the handshake runs again. Generous
// because it is not the security boundary: the office session behind it is
// revalidated on EVERY request, so a sign-out, a revoke or a demotion closes the
// app immediately regardless of this number. It only decides how often a user
// pays one invisible redirect.
export const APP_SESSION_TTL_MS = 12 * 60 * 60 * 1000;

// Mint budget, per office session. Also the loop breaker: if a browser refuses
// the app cookie — an office declaring https while its terminator actually
// serves plain http — the bounce/mint pair would otherwise repeat forever.
export const APP_MINT_MAX_PER_WINDOW = 20;
export const APP_MINT_WINDOW_MS = 60_000;

// Redeem budget, per app label. Nuisance control, not the boundary: guessing a
// 256-bit code is not a thing that happens. Keyed by label because there is no
// usable per-caller key — the office sits behind a terminator on the same box,
// so every external request arrives from loopback, and `X-Forwarded-*` is not
// trustworthy here. The cost of that choice, stated rather than hidden: someone
// hammering one app's hostname can spend that app's redeem budget for a minute,
// and its legitimate users wait.
export const APP_REDEEM_MAX_PER_WINDOW = 60;
export const APP_REDEEM_WINDOW_MS = 60_000;

// Table ceilings, so churn cannot grow memory without bound.
export const MAX_PENDING_CODES = 512;
export const MAX_APP_SESSIONS = 4096;
export const MAX_TRACKED_LIMITER_KEYS = 1024;

// A return path is a path, not a URL, and 2KB is far past any real one.
export const MAX_RETURN_PATH_LENGTH = 2048;

// Codes and cookie values are both 32 random bytes in base64url (43 chars). The
// cap and the alphabet are checked BEFORE hashing, so an attacker cannot make
// the server hash a megabyte, and a malformed value never reaches a table at all.
export const MAX_TOKEN_LENGTH = 64;
export const TOKEN_PATTERN = /^[A-Za-z0-9_-]+$/;

const TOKEN_BYTES = 32; // 256 bits, matching the office session id

// --- primitives -------------------------------------------------------------

export function randomTokenValue(): string {
  return randomBytes(TOKEN_BYTES).toString("base64url");
}

export function hashOf(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}

// Constant-time compare of two sha256 hex digests. The Map lookup already found
// the row; this is the belt on top of it, so a near-miss cannot be distinguished
// by timing. Same shape as the session store's own safeHashEq.
export function safeHashEq(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

// A well-formed token, checked before anything hashes or looks it up.
export function isTokenShaped(raw: string | null): raw is string {
  if (raw === null || raw.length === 0) return false;
  if (raw.length > MAX_TOKEN_LENGTH) return false;
  return TOKEN_PATTERN.test(raw);
}

// --- Set-Cookie lines -------------------------------------------------------

// Attributes in the same order the office cookie is written. `Secure` is
// unconditional: the app-host arm only exists on an https office, and the
// `__Host-` prefix makes a browser drop the cookie without it. (The office's own
// cookie helpers make `Secure` conditional because the office also runs on
// loopback http; an app hostname never does, so there is nothing to condition
// on here — and a conditional would be a way to write a `__Host-` cookie the
// browser silently discards.)
export function appCookieLine(value: string, maxAgeSec: number): string {
  return [`${APP_COOKIE_NAME}=${value}`, "Path=/", "HttpOnly", "SameSite=Lax", `Max-Age=${maxAgeSec}`, "Secure"].join("; ");
}

export function appCookieClearLine(): string {
  return appCookieLine("", 0);
}

// The app cookie as it arrived. `null` means ABSENT; a cookie that is present
// with an empty value is `""`, and that distinction is load-bearing — it is the
// same one readSessionCookies draws for the office cookie. An empty value never
// authenticates, but it IS something sitting in the browser, so it has to be
// cleared rather than treated as nothing to clean up.
//
// First occurrence wins per name: a browser sends the more specific match first
// (RFC 6265) and a later duplicate must not overwrite it.
export function readAppCookie(req: Request): string | null {
  const header = req.headers.get("cookie");
  if (!header) return null;
  for (const part of header.split(";")) {
    const idx = part.indexOf("=");
    if (idx <= 0) continue;
    if (part.slice(0, idx).trim() !== APP_COOKIE_NAME) continue;
    return part.slice(idx + 1).trim();
  }
  return null;
}
