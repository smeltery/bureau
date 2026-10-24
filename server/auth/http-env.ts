import { validateSession } from "./session-validation.ts";
import { normalizePublicOrigin } from "../../shared/public-origin.ts";

import { join } from "node:path";
import { BUREAU_DIR } from "../persistence/paths.ts";
import { readOrCreateOfficeId } from "./cookies/office-id.ts";
import { OfficeCookiePolicy, type SessionCookies } from "./cookies/policy.ts";
export type { SessionCookies } from "./cookies/policy.ts";

const cookiePolicy = new OfficeCookiePolicy(readOrCreateOfficeId(join(BUREAU_DIR, "office-id")));
export const COOKIE_NAME = cookiePolicy.names.plain;
export const HOST_COOKIE_NAME = cookiePolicy.names.host;

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

export function cookieWriteName(isHttps: boolean): string {
  return cookiePolicy.writeName(isHttps);
}

export function setCookieHeader(rawSessionId: string, absoluteExpiresAt: number): string {
  return cookiePolicy.set(rawSessionId, absoluteExpiresAt, buildPublicOrigin().isHttps);
}

export function clearCookieLines(isHttps: boolean, cookies?: SessionCookies, authenticatedRaw?: string | null): string[] {
  return cookiePolicy.clear(isHttps, cookies, authenticatedRaw);
}

export function clearCookieHeaders(cookies?: SessionCookies, authenticatedRaw?: string | null): string[] {
  return clearCookieLines(buildPublicOrigin().isHttps, cookies, authenticatedRaw);
}

export function readSessionCookies(req: Request, isHttps = buildPublicOrigin().isHttps): SessionCookies {
  return cookiePolicy.read(req, isHttps, (raw) => validateSession(raw || null) !== null);
}

export function readSessionCookie(req: Request, isHttps = buildPublicOrigin().isHttps): string | null {
  return readSessionCookies(req, isHttps).selected || null;
}

export function sessionCookieMigrationHeaders(cookies: SessionCookies, session: { sessionIdHash: string; absoluteExpiresAt: number }): string[] {
  return cookiePolicy.migrate(cookies, session, buildPublicOrigin().isHttps);
}
