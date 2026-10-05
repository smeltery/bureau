import type { Server } from "bun";
import { requestPeer, requestSource } from "../auth/auth-request-guards.ts";
import { allowReadyRequest } from "../ready-limiter.ts";

const JSON_HEADERS = { "Access-Control-Allow-Origin": "*", "Content-Type": "application/json" };

export interface ReadyHttpDeps<T> {
  server: Server<T>;
  now(): number;
}

export function handleReadyRequest<T>(req: Request, url: URL, deps: ReadyHttpDeps<T>): Response | null {
  if (url.pathname !== "/readyz" || req.method !== "GET") return null;

  const source = requestSource(req, requestPeer(req, deps.server));
  if (!source.onBox && !allowReadyRequest(source.client, deps.now())) {
    return new Response(JSON.stringify({ ok: false, error: "rate_limited" }), {
      status: 429,
      headers: JSON_HEADERS,
    });
  }

  return new Response(JSON.stringify({ ok: true }), { headers: JSON_HEADERS });
}
