import type { Server } from "bun";
import { buildPublicOrigin } from "./auth.ts";

function isLoopback(addr: string | null): boolean {
  if (!addr) return false;
  return addr === "127.0.0.1" || addr === "::1" || addr === "::ffff:127.0.0.1" || addr.startsWith("127.");
}

export type TrustedProxy = "none" | "same-host" | "load-balancer";

// A proxy can add one of these but a client cannot strip the one the proxy
// adds, so a header can only ever make a request off-box.
const FORWARDING_HEADERS = ["forwarded", "x-forwarded-for", "x-forwarded-host", "x-forwarded-proto", "x-real-ip", "cf-connecting-ip", "fly-client-ip"];

let warnedTrustedProxy = false;

export function trustedProxy(raw = process.env.BUREAU_TRUSTED_PROXY): TrustedProxy {
  const value = raw?.trim() || "none";
  if (value === "none" || value === "same-host" || value === "load-balancer") return value;
  if (!warnedTrustedProxy) {
    warnedTrustedProxy = true;
    console.error(`[proxy-trust] BUREAU_TRUSTED_PROXY must be "none", "same-host", or "load-balancer"; got "${value}", using none`);
  }
  return "none";
}

export function requestPeer<T>(req: Request, server: Server<T>): string | null {
  try {
    return server.requestIP(req)?.address ?? null;
  } catch {
    return null;
  }
}

/**
 * Where a request comes from. `onBox` is a loopback peer with no forwarding
 * header — the same rule in every mode, so a same-host proxy (Caddy,
 * `tailscale serve`, Funnel) never passes for a local process. `client` is the
 * rate-limit key: the peer, or the rightmost X-Forwarded-For entry (the one
 * the proxy wrote) when the request came through the declared proxy.
 */
export function requestSource(req: Request, peer: string | null, mode: TrustedProxy = trustedProxy()): { onBox: boolean; client: string } {
  const loopback = isLoopback(peer);
  const onBox = loopback && !FORWARDING_HEADERS.some((name) => req.headers.has(name));
  const viaProxy = (mode === "same-host" && loopback) || (mode === "load-balancer" && peer !== null && !loopback);
  const forwarded = viaProxy ? req.headers.get("x-forwarded-for")?.split(",").at(-1)?.trim() || null : null;
  return { onBox, client: forwarded ?? peer ?? "unknown" };
}

export function requestIsOnBox<T>(req: Request, server: Server<T>): boolean {
  return requestSource(req, requestPeer(req, server)).onBox;
}

export function checkOrigin(req: Request): boolean {
  const origin = req.headers.get("origin");
  if (!origin) return false;
  const { origin: expected } = buildPublicOrigin();
  return origin === expected;
}

function hasSameOriginFetchMetadata(req: Request): boolean {
  return req.headers.get("sec-fetch-site") === "same-origin";
}

export function originValidForAuthPost(req: Request): boolean {
  const origin = req.headers.get("origin");
  if (origin === null || origin === "null") {
    return hasSameOriginFetchMetadata(req);
  }
  if (origin === "") return false;
  return checkOrigin(req);
}

export function isLoopbackOrigin(origin: string): boolean {
  const port = process.env.PORT || "4000";
  return origin === `http://localhost:${port}` || origin === `http://127.0.0.1:${port}`;
}
