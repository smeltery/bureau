// Thin compatibility shim. The authoritative public-origin policy lives in
// server/auth/auth.ts (boot-frozen with cookie/bind semantics); this module
// re-exposes it for callers that just want the effective origin string and
// for the Origin-allowlist checks the HTTP/WebSocket entry points apply
// before auth runs.

import { buildPublicOrigin } from "./auth/auth.ts";

export function getPublicOrigin(): string {
  return buildPublicOrigin().origin;
}

function parseOrigin(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return url.origin;
  } catch {
    return null;
  }
}

// Allow either the public origin OR the URL the request itself was made
// against (so a same-host loopback hit keeps working when external access
// is on with a non-loopback configured origin). Browsers always send Origin;
// non-browser callers (agents on the same host) don't — those skip this
// check via the loopback bypass at the auth layer.
export function originAllowed(req: Request, requestUrl: URL): boolean {
  const origin = req.headers.get("Origin");
  if (!origin) return true;

  const parsedOrigin = parseOrigin(origin);
  if (!parsedOrigin) return false;

  return parsedOrigin === requestUrl.origin || parsedOrigin === getPublicOrigin();
}

export function stateChangingOriginAllowed(req: Request, requestUrl: URL): boolean {
  if (req.method === "GET" || req.method === "HEAD" || req.method === "OPTIONS") {
    return true;
  }
  return originAllowed(req, requestUrl);
}
