import type { AuthResult } from "../auth/auth-middleware.ts";
import { updateUserForApi } from "./access-adapters.ts";
import { listProviderAccounts, setProviderKeys } from "../provider-accounts/index.ts";
import type { ProviderKeysUpdateReq } from "../../shared/provider-accounts.ts";

const jsonHeaders = { "Access-Control-Allow-Origin": "*", "Content-Type": "application/json" };

export async function handleProviderAccountsRequest(req: Request, url: URL, auth: AuthResult): Promise<Response | null> {
  if (!url.pathname.startsWith("/api/me/provider-accounts")) return null;

  if (req.method === "OPTIONS") {
    return new Response(null, {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, POST, PUT, OPTIONS",
        "Access-Control-Allow-Headers": "Authorization, Content-Type",
      },
    });
  }

  if (auth.kind !== "ok") return error(401, "authenticated browser session required");

  const userId = auth.session.userId;
  const username = auth.session.username;

  if (url.pathname === "/api/me/provider-accounts" && req.method === "GET") {
    return json(listProviderAccounts(userId, false));
  }

  if (url.pathname === "/api/me/provider-accounts/refresh" && req.method === "POST") {
    return json(listProviderAccounts(userId, true));
  }

  if (url.pathname === "/api/me/provider-accounts/keys" && req.method === "PUT") {
    const body = await readKeysBody(req);
    if (body instanceof Response) return body;
    const result = setProviderKeys(userId, body);
    if (!result.ok) return error(result.status, result.error);
    // Point the user record at the managed env file when keys land there.
    const link = await updateUserForApi(userId, auth.session.role, username, { envFile: result.envPath });
    if (!link.ok) return error(link.status, link.error);
    return json(result.value);
  }

  return error(404, "not found");
}

async function readKeysBody(req: Request): Promise<ProviderKeysUpdateReq | Response> {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return error(400, "invalid JSON");
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return error(400, "body must be an object");
  const body = raw as Record<string, unknown>;
  const out: ProviderKeysUpdateReq = {};
  if ("anthropicApiKey" in body) {
    if (typeof body.anthropicApiKey !== "string") return error(400, "anthropicApiKey must be a string");
    out.anthropicApiKey = body.anthropicApiKey;
  }
  if ("openaiApiKey" in body) {
    if (typeof body.openaiApiKey !== "string") return error(400, "openaiApiKey must be a string");
    out.openaiApiKey = body.openaiApiKey;
  }
  return out;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: jsonHeaders });
}

function error(status: number, message: string): Response {
  return json({ error: message }, status);
}
