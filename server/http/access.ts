import type { AuthResult } from "../auth/auth-middleware.ts";

const JSON_HEADERS = { "Access-Control-Allow-Origin": "*", "Content-Type": "application/json" };

export interface AccessSettingsWire {
  externalAccess: boolean;
  publicOrigin: string | null;
  envOriginSet: boolean;
  envOrigin: string | null;
  boundLoopback: boolean;
  officeName: string | null;
}

export type SetAccessResult = { ok: true; signInUrl: string | null; restartRequired: boolean } | { ok: false; status: number; error: string; envOrigin?: string | null };

export interface AccessHttpDeps {
  get(): AccessSettingsWire;
  set(input: { externalAccess: boolean; publicOrigin: string }): Promise<SetAccessResult>;
}

export async function handleAccessRequest(req: Request, url: URL, auth: AuthResult | undefined, deps: AccessHttpDeps): Promise<Response | null> {
  if (req.method === "OPTIONS" && url.pathname === "/api/office/access") {
    return new Response(null, {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, PUT, OPTIONS",
        "Access-Control-Allow-Headers": "Authorization, Content-Type",
      },
    });
  }

  if (url.pathname !== "/api/office/access") return null;
  if (auth?.kind !== "ok") return jsonError(401, "authenticated browser session required");
  if (auth.session.role !== "owner") return jsonError(403, "owner access required");

  if (req.method === "GET") {
    return new Response(JSON.stringify(deps.get()), { headers: JSON_HEADERS });
  }

  if (req.method === "PUT") {
    const body = await readJson(req);
    if (body instanceof Response) return body;
    if (typeof body.externalAccess !== "boolean") return jsonError(400, "externalAccess (boolean) is required");
    const publicOrigin = typeof body.publicOrigin === "string" ? body.publicOrigin : "";
    const result = await deps.set({ externalAccess: body.externalAccess, publicOrigin });
    return result.ok
      ? new Response(JSON.stringify({ signInUrl: result.signInUrl, restartRequired: result.restartRequired }), { headers: JSON_HEADERS })
      : jsonError(result.status, result.error, result.envOrigin);
  }

  return jsonError(404, "not found");
}

async function readJson(req: Request): Promise<Record<string, unknown> | Response> {
  try {
    return (await req.json()) as Record<string, unknown>;
  } catch {
    return jsonError(400, "invalid JSON");
  }
}

function jsonError(status: number, error: string, envOrigin?: string | null): Response {
  return new Response(JSON.stringify(envOrigin === undefined ? { error } : { error, envOrigin }), { status, headers: JSON_HEADERS });
}
