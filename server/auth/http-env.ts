import { normalizePublicOrigin } from "../../shared/public-origin.ts";

export const COOKIE_NAME = "bureau_session";

// The `__Host-` name. The prefix is browser-enforced: a cookie carrying it is
// only accepted with `Secure`, `Path=/`, and NO `Domain` attribute — so a page
// on a sibling subdomain of the office host can never write a cookie the
// office will read. That forecloses cookie shadowing from anything else served
// under the same parent domain.
//
// Because the prefix requires `Secure`, the name is only WRITABLE on an HTTPS
// deployment. Both names are READ everywhere (readSessionCookies), so no
// existing session is logged out and a loopback-HTTP install behaves exactly
// as it did before.
export const HOST_COOKIE_NAME = "__Host-bureau_session";

let hasOwnerProvider: () => boolean = () => false;

export function setHasOwnerProvider(fn: () => boolean): void {
  hasOwnerProvider = fn;
}

let cachedFallbackOrigin: string | null = null;
let envEvaluated = false;
let envCachedOrigin: string | null = null;

export function setPublicOriginFallback(origin: string | null): void {
  cachedFallbackOrigin = origin;
}

function evaluateEnvOrigin(): string | null {
  if (envEvaluated) return envCachedOrigin;
  envEvaluated = true;
  const raw = process.env.BUREAU_PUBLIC_ORIGIN?.trim();
  if (!raw) {
    envCachedOrigin = null;
    return null;
  }
  const normalized = normalizePublicOrigin(raw);
  if (!normalized) {
    console.error(`[auth] BUREAU_PUBLIC_ORIGIN="${raw}" is not a valid public origin (need https://<host> or http://localhost; no path/query/fragment); ignoring`);
    envCachedOrigin = null;
    return null;
  }
  envCachedOrigin = normalized;
  return normalized;
}

let bootHadOwner: boolean | null = null;
let bootExternalAccess: boolean | null = null;
let bootNetworkBind: "auto" | "loopback" | "all" | null = null;

export function freezeBootState(opts: { externalAccess: boolean; networkBind?: "auto" | "loopback" | "all" }): void {
  bootHadOwner = hasOwnerProvider();
  bootExternalAccess = opts.externalAccess;
  bootNetworkBind = opts.networkBind ?? "auto";
}

let officeName: string | null = null;

export function setOfficeName(name: string | null): void {
  officeName = name && name.trim() ? name.trim().slice(0, 64) : null;
}

export function getOfficeName(): string | null {
  return officeName;
}

function ensureBootCaptured(): void {
  if (bootHadOwner === null) bootHadOwner = hasOwnerProvider();
  if (bootExternalAccess === null) bootExternalAccess = false;
  if (bootNetworkBind === null) bootNetworkBind = "auto";
}

export function isProcessPreClaim(): boolean {
  ensureBootCaptured();
  return bootHadOwner === false;
}

export function isProcessBoundLoopback(): boolean {
  ensureBootCaptured();
  return bootHadOwner === false || (bootNetworkBind === "auto" && bootExternalAccess !== true) || bootNetworkBind === "loopback";
}

export function isOutsideReachabilityBlocked(): boolean {
  ensureBootCaptured();
  return bootHadOwner === false || bootExternalAccess !== true;
}

export function buildPublicOrigin(): {
  origin: string;
  isHttps: boolean;
  source: "env" | "config" | "localhost";
} {
  if (isOutsideReachabilityBlocked()) {
    const fallback = `http://localhost:${process.env.PORT || "4000"}`;
    return { origin: fallback, isHttps: false, source: "localhost" };
  }
  const envOrigin = evaluateEnvOrigin();
  if (envOrigin) {
    return { origin: envOrigin, isHttps: envOrigin.startsWith("https://"), source: "env" };
  }
  if (cachedFallbackOrigin) {
    return {
      origin: cachedFallbackOrigin,
      isHttps: cachedFallbackOrigin.startsWith("https://"),
      source: "config",
    };
  }
  const fallback = `http://localhost:${process.env.PORT || "4000"}`;
  return { origin: fallback, isHttps: false, source: "localhost" };
}

// The name a freshly written cookie carries. `__Host-` only on HTTPS — the
// same `isHttps` that adds `Secure` picks the name, so the server is
// structurally incapable of writing the prefixed name without the attributes
// the prefix demands (a browser would silently drop such a cookie, which on
// the login path means a session that never starts).
export function cookieWriteName(isHttps: boolean): string {
  return isHttps ? HOST_COOKIE_NAME : COOKIE_NAME;
}

// Attribute order is load-bearing only in that the plain-HTTP arm must stay
// byte-for-byte what it was before the `__Host-` work; keep it as-is.
function cookieLine(name: string, value: string, maxAgeSec: number, isHttps: boolean): string {
  const attrs = [`${name}=${value}`, `Path=/`, `HttpOnly`, `SameSite=Lax`, `Max-Age=${maxAgeSec}`];
  if (isHttps) attrs.push("Secure");
  return attrs.join("; ");
}

function maxAgeUntil(absoluteExpiresAt: number): number {
  return Math.max(0, Math.floor((absoluteExpiresAt - Date.now()) / 1000));
}

// Build the Set-Cookie header value. Max-Age anchors to the absolute cap so
// the cookie naturally expires when the session can't be rolled any further.
export function setCookieHeader(rawSessionId: string, absoluteExpiresAt: number): string {
  const { isHttps } = buildPublicOrigin();
  return cookieLine(cookieWriteName(isHttps), rawSessionId, maxAgeUntil(absoluteExpiresAt), isHttps);
}

// Sign-out clears BOTH names, on every deployment — not just the one this
// office would write today. An office that has been on HTTPS and then went
// back to loopback (external access turned off) leaves browsers holding a
// `__Host-` cookie, which is still dual-read — so a sign-out that skipped it
// would revoke the session server-side and leave the cookie sitting in the
// browser. The `__Host-` clear carries `Secure` because the prefix rules apply
// to a deletion too; browsers treat localhost as trustworthy, so it lands on a
// loopback office as well.
export function clearCookieLines(isHttps: boolean): string[] {
  return [cookieLine(COOKIE_NAME, "", 0, isHttps), cookieLine(HOST_COOKIE_NAME, "", 0, true)];
}

export function clearCookieHeaders(): string[] {
  const { isHttps } = buildPublicOrigin();
  return clearCookieLines(isHttps);
}

// Both session cookies as they arrived, plus which one the request is
// claiming. `null` means ABSENT; a present cookie with an empty value is `""`.
// The distinction matters: `__Host-bureau_session=` is present, so it blocks
// the legacy fallback and the request fails closed rather than being rescued
// by a legacy cookie alongside it.
export interface SessionCookies {
  hostRaw: string | null;
  legacyRaw: string | null;
  // Name precedence, decided by PRESENCE and never by validity: the `__Host-`
  // cookie wins whenever it arrives at all. An injected or stale legacy cookie
  // therefore cannot displace the authoritative one, in either header order.
  selected: string | null;
}

// Parse the `Cookie` request header. Multi-cookie strings ("a=1; b=2") parsed
// without bringing in a dependency.
export function readSessionCookies(req: Request): SessionCookies {
  let hostRaw: string | null = null;
  let legacyRaw: string | null = null;
  const header = req.headers.get("cookie");
  if (header) {
    for (const part of header.split(";")) {
      const idx = part.indexOf("=");
      if (idx <= 0) continue;
      const name = part.slice(0, idx).trim();
      const value = part.slice(idx + 1).trim();
      // First occurrence wins per name: RFC 6265 has the browser send the
      // more specific match first, and a later duplicate under the same name
      // must never overwrite it.
      if (name === HOST_COOKIE_NAME) {
        if (hostRaw === null) hostRaw = value;
      } else if (name === COOKIE_NAME) {
        if (legacyRaw === null) legacyRaw = value;
      }
    }
  }
  return { hostRaw, legacyRaw, selected: hostRaw !== null ? hostRaw : legacyRaw };
}

// The raw session id to validate, or null when there is nothing to validate.
// An empty selected value is "nothing to validate" — and because selection
// already happened, an empty `__Host-` cookie lands here as null instead of
// falling back to a legacy cookie on the same request.
export function readSessionCookie(req: Request): string | null {
  return readSessionCookies(req).selected || null;
}

// The two-step migration onto the `__Host-` name, as Set-Cookie lines (never
// more than one — the steps must land in DIFFERENT responses).
//
// PURE with respect to identity: callers pass the cookies they already parsed
// plus the session that already authenticated, so this can never select a
// different identity than the one the caller authorized.
//
//   1. UPGRADE — the request authenticated through the legacy cookie and
//      carries no `__Host-` cookie at all. Re-issue the SAME raw session id
//      under the new name and leave the legacy cookie alone.
//   2. RETIRE — a `__Host-` cookie came back from the browser (so it accepted
//      the upgrade, and by name precedence it is what authenticated this
//      request) while a legacy cookie is still around. Clear the legacy name.
//
// Splitting the steps is what makes the migration incapable of signing anyone
// out: nothing is ever cleared until its replacement has been OBSERVED. A
// browser that refuses the new cookie (an office declaring HTTPS while its
// terminator actually serves plain HTTP) just keeps the old one forever.
export function sessionCookieMigrationLines(cookies: Pick<SessionCookies, "hostRaw" | "legacyRaw">, absoluteExpiresAt: number, isHttps: boolean): string[] {
  if (!isHttps) return [];
  if (cookies.hostRaw === null && cookies.legacyRaw !== null) {
    // The value re-issued is the raw id that was just validated — the only
    // cookie on this request that could have produced the caller's session.
    // Max-Age anchors to the SAME absolute cap the original cookie was
    // anchored to: a migration must never extend a session's life.
    return [cookieLine(HOST_COOKIE_NAME, cookies.legacyRaw, maxAgeUntil(absoluteExpiresAt), true)];
  }
  if (cookies.hostRaw !== null && cookies.legacyRaw !== null) {
    return [cookieLine(COOKIE_NAME, "", 0, true)];
  }
  return [];
}

export function sessionCookieMigrationHeaders(cookies: Pick<SessionCookies, "hostRaw" | "legacyRaw">, session: { absoluteExpiresAt: number }): string[] {
  const { isHttps } = buildPublicOrigin();
  return sessionCookieMigrationLines(cookies, session.absoluteExpiresAt, isHttps);
}
