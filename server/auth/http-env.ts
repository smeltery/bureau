import { normalizePublicOrigin } from "../../shared/public-origin.ts";

export const COOKIE_NAME = "bureau_session";

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

export function freezeBootState(opts: { externalAccess: boolean }): void {
  bootHadOwner = hasOwnerProvider();
  bootExternalAccess = opts.externalAccess;
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
}

export function isProcessPreClaim(): boolean {
  ensureBootCaptured();
  return bootHadOwner === false;
}

export function isProcessBoundLoopback(): boolean {
  ensureBootCaptured();
  return bootHadOwner === false || bootExternalAccess !== true;
}

export function buildPublicOrigin(): {
  origin: string;
  isHttps: boolean;
  source: "env" | "config" | "localhost";
} {
  if (isProcessBoundLoopback()) {
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

export function setCookieHeader(rawSessionId: string, absoluteExpiresAt: number): string {
  const { isHttps } = buildPublicOrigin();
  const maxAgeSec = Math.max(0, Math.floor((absoluteExpiresAt - Date.now()) / 1000));
  const attrs = [`${COOKIE_NAME}=${rawSessionId}`, `Path=/`, `HttpOnly`, `SameSite=Lax`, `Max-Age=${maxAgeSec}`];
  if (isHttps) attrs.push("Secure");
  return attrs.join("; ");
}

export function clearCookieHeader(): string {
  const { isHttps } = buildPublicOrigin();
  const attrs = [`${COOKIE_NAME}=`, `Path=/`, `HttpOnly`, `SameSite=Lax`, `Max-Age=0`];
  if (isHttps) attrs.push("Secure");
  return attrs.join("; ");
}

export function readSessionCookie(req: Request): string | null {
  const header = req.headers.get("cookie");
  if (!header) return null;
  const parts = header.split(";");
  for (const part of parts) {
    const idx = part.indexOf("=");
    if (idx <= 0) continue;
    const name = part.slice(0, idx).trim();
    if (name !== COOKIE_NAME) continue;
    const value = part.slice(idx + 1).trim();
    return value || null;
  }
  return null;
}
