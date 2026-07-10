import type { Server } from "bun";
import { buildPublicOrigin } from "./auth.ts";

function isLoopback(addr: string | null): boolean {
  if (!addr) return false;
  return addr === "127.0.0.1" || addr === "::1" || addr === "::ffff:127.0.0.1" || addr.startsWith("127.");
}

export function requestIsLoopback<T>(req: Request, server: Server<T>): boolean {
  try {
    const info = server.requestIP(req);
    return isLoopback(info?.address ?? null);
  } catch {
    return false;
  }
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
