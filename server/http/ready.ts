import type { Server } from "bun";
import { allowReadyRequest } from "../ready-limiter.ts";

const JSON_HEADERS = { "Access-Control-Allow-Origin": "*", "Content-Type": "application/json" };

export interface ReadyHttpDeps<T> {
  server: Server<T>;
  now(): number;
}

export function handleReadyRequest<T>(req: Request, url: URL, deps: ReadyHttpDeps<T>): Response | null {
  if (url.pathname !== "/readyz" || req.method !== "GET") return null;

  const ip = clientIp(req, deps.server);
  if (!isLoopback(ip) && !allowReadyRequest(ip ?? "unknown", deps.now())) {
    return new Response(JSON.stringify({ ok: false, error: "rate_limited" }), {
      status: 429,
      headers: JSON_HEADERS,
    });
  }

  return new Response(JSON.stringify({ ok: true }), { headers: JSON_HEADERS });
}

function clientIp<T>(req: Request, server: Server<T>): string | null {
  try {
    return server.requestIP(req)?.address ?? null;
  } catch {
    return null;
  }
}

function isLoopback(ip: string | null): boolean {
  return ip === "127.0.0.1" || ip === "::1" || ip === "::ffff:127.0.0.1" || ip?.startsWith("127.") === true;
}
