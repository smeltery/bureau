import type { AuthResult } from "../auth/auth-middleware.ts";
import { updateUserForApi } from "./access-adapters.ts";
import { acquireSignInSlot, listProviderAccounts, releaseSignInSlot, setProviderKeys } from "../provider-accounts/index.ts";
import type { ProviderAccountProvider, ProviderKeysUpdateReq } from "../../shared/provider-accounts.ts";

const jsonHeaders = { "Access-Control-Allow-Origin": "*", "Content-Type": "application/json" };

const PROVIDERS = new Set<ProviderAccountProvider>(["claude", "codex"]);

export async function handleProviderAccountsRequest(req: Request, url: URL, auth: AuthResult): Promise<Response | null> {
  if (!url.pathname.startsWith("/api/me/provider-accounts")) return null;

  if (req.method === "OPTIONS") {
    return new Response(null, {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
        "Access-Control-Allow-Headers": "Authorization, Content-Type",
      },
    });
  }

  if (auth.kind !== "ok") return error(401, "authenticated browser session required");

  const userId = auth.session.userId;
  const username = auth.session.username;
  const role = auth.session.role;

  if (url.pathname === "/api/me/provider-accounts" && req.method === "GET") {
    return json(await listProviderAccounts(userId, false));
  }

  if (url.pathname === "/api/me/provider-accounts/refresh" && req.method === "POST") {
    return json(await listProviderAccounts(userId, true));
  }

  if (url.pathname === "/api/me/provider-accounts/keys" && req.method === "PUT") {
    const body = await readKeysBody(req);
    if (body instanceof Response) return body;
    const result = await setProviderKeys(userId, body);
    if (!result.ok) return error(result.status, result.error);
    // Point the user record at the managed env file when keys land there.
    const link = await updateUserForApi(userId, role, username, { envFile: result.envPath });
    if (!link.ok) return error(link.status, link.error);
    return json(result.value);
  }

  const signInMatch = url.pathname.match(/^\/api\/me\/provider-accounts\/(claude|codex)\/sign-in$/);
  if (signInMatch) {
    const provider = signInMatch[1] as ProviderAccountProvider;
    if (!PROVIDERS.has(provider)) return error(404, "not found");

    if (req.method === "POST") {
      const acquired = acquireSignInSlot(userId, provider);
      if (!acquired.ok) {
        return json(
          {
            error: "shared_login_in_progress",
            code: "shared_login_in_progress",
            detail: acquired.detail,
          },
          409,
        );
      }
      const listed = await listProviderAccounts(userId, false);
      return json({
        accounts: listed.accounts,
        queue: { holderName: acquired.slot.holderName, startedAt: acquired.slot.startedAt },
      });
    }

    if (req.method === "DELETE") {
      const allowForeign = role === "owner";
      const released = releaseSignInSlot(userId, provider, allowForeign);
      if (!released) return error(404, "no sign-in in progress");
      return json(await listProviderAccounts(userId, false));
    }
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
