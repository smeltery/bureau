import type { ApiTokenWire } from "../../shared/types.ts";
import type { AuthResult } from "./auth-middleware.ts";
import { API_TOKEN_EXPIRY_DAYS, listApiTokens, mintApiToken, revokeApiToken } from "./api-tokens.ts";

const JSON_HEADERS = { "Access-Control-Allow-Origin": "*", "Content-Type": "application/json" };

export async function handleApiTokensRequest(req: Request, url: URL, auth: AuthResult | undefined): Promise<Response | null> {
  if (req.method === "OPTIONS" && url.pathname.startsWith("/api/api-tokens")) {
    return new Response(null, {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
        "Access-Control-Allow-Headers": "Authorization, Content-Type",
      },
    });
  }
  if (!url.pathname.startsWith("/api/api-tokens")) return null;
  if (auth?.kind !== "ok") return jsonError(401, "authenticated session required");

  if (url.pathname === "/api/api-tokens" && req.method === "GET") {
    return json({ apiTokens: listApiTokens(auth.session.userId) });
  }

  if (url.pathname === "/api/api-tokens" && req.method === "POST") {
    const body = await readJson(req);
    if (body instanceof Response) return body;
    const name = typeof body.name === "string" ? body.name.trim() : "";
    if (!name || name.length > 64) return jsonError(422, "name must be between 1 and 64 characters");
    const expiresInDays = body.expiresInDays;
    if (!(API_TOKEN_EXPIRY_DAYS as readonly unknown[]).includes(expiresInDays)) {
      return jsonError(422, "expiresInDays must be 30, 365, or null");
    }
    return json(await mintApiToken({ userId: auth.session.userId, name, expiresInDays: expiresInDays as number | null }), 201);
  }

  const match = /^\/api\/api-tokens\/([^/]+)$/.exec(url.pathname);
  if (match && req.method === "DELETE") {
    if (!(await revokeApiToken(auth.session.userId, decodeURIComponent(match[1])))) return jsonError(404, "API token not found");
    return new Response(null, { status: 204, headers: JSON_HEADERS });
  }

  return jsonError(404, "not found");
}

function json(body: { apiTokens: ApiTokenWire[] } | { token: string; apiToken: ApiTokenWire }, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

async function readJson(req: Request): Promise<Record<string, unknown> | Response> {
  try {
    return (await req.json()) as Record<string, unknown>;
  } catch {
    return jsonError(400, "invalid JSON");
  }
}

function jsonError(status: number, error: string): Response {
  return new Response(JSON.stringify({ error }), { status, headers: JSON_HEADERS });
}
