import type { AuthResult } from "../auth/auth-middleware.ts";
import * as AgentManager from "../agent-manager.ts";
import { getUserByName } from "../users.ts";
import { updateUserForApi } from "./access-adapters.ts";
import {
  ManagedEnvValidationError,
  managedOfficeEnvPath,
  managedUserEnvPath,
  readManagedUserEnv,
  readManagedOfficeEnv,
  writeManagedOfficeEnv,
  writeManagedUserEnv,
} from "../persistence/managed-env.ts";

const jsonHeaders = { "Access-Control-Allow-Origin": "*", "Content-Type": "application/json" };
const noContentHeaders = { "Access-Control-Allow-Origin": "*" };

export async function handleOfficeSettingsRequest(req: Request, url: URL, auth: AuthResult): Promise<Response | null> {
  if (req.method === "OPTIONS" && url.pathname === "/api/office/settings") {
    return new Response(null, {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, PUT, OPTIONS",
        "Access-Control-Allow-Headers": "Authorization, Content-Type",
      },
    });
  }

  if (url.pathname !== "/api/office/settings") return null;
  // DELIBERATELY owner-session-only: no `privilegedAgentIdentity` path here. The
  // office prompt is the top of the prompt chain injected into every agent in
  // the office, including the privileged one asking — letting an agent rewrite
  // it would let it rewrite its own standing instructions and every peer's.
  // Upstream excludes `office:admin` from the privileged set for the same
  // reason. Rooms are the boundary a privileged agent manages; the office is not.
  if (auth.kind !== "ok") return error(401, "authenticated browser session required");
  if (auth.session.role !== "owner") return error(403, "owner access required");

  if (req.method === "GET") {
    return new Response(JSON.stringify(AgentManager.getOfficeSettings()), { headers: jsonHeaders });
  }

  if (req.method === "PUT") {
    const body = await readJson(req);
    if (body instanceof Response) return body;
    const prompt = typeof body.prompt === "string" ? body.prompt : null;
    const envFile = typeof body.envFile === "string" && body.envFile.trim() ? body.envFile.trim() : null;
    if (envFile) {
      try {
        AgentManager.validateEnvPath(envFile);
      } catch (err) {
        return error(422, err instanceof Error ? err.message : "invalid env file");
      }
    }
    AgentManager.setOfficeSettings(prompt, envFile);
    return new Response(null, { status: 204, headers: noContentHeaders });
  }

  return error(404, "not found");
}

export async function handleEnvSettingsRequest(req: Request, url: URL, auth: AuthResult): Promise<Response | null> {
  const route = parseEnvRoute(url.pathname);
  if (!route) return null;
  if (auth.kind !== "ok") return error(401, "authenticated browser session required");
  if (route.scope === "office" && auth.session.role !== "owner") return error(403, "owner access required");

  if (route.scope === "user") {
    const target = getUserByName(route.username);
    if (!target) return error(404, "user not found");

    if (route.names) {
      if (auth.session.role !== "owner") return error(403, "owner access required");
      if (req.method === "GET") {
        try {
          return json({ names: Object.keys(readManagedUserEnv(target.id)).sort((a, b) => a.localeCompare(b)) });
        } catch {
          return error(500, "could not read managed env file");
        }
      }
      return error(404, "not found");
    }

    if (auth.session.role !== "owner" && auth.session.userId !== target.id) return error(403, "forbidden");

    if (req.method === "GET") {
      try {
        return json({ mode: "managed", path: managedUserEnvPath(target.id), values: readManagedUserEnv(target.id) });
      } catch {
        return error(500, "could not read managed env file");
      }
    }

    if (req.method === "PUT") {
      const values = await valuesFromRequest(req);
      if (values instanceof Response) return values;
      try {
        writeManagedUserEnv(target.id, values);
        const result = await updateUserForApi(auth.session.userId, auth.session.role, target.name, { envFile: managedUserEnvPath(target.id) });
        return result.ok ? new Response(null, { status: 204, headers: noContentHeaders }) : error(result.status, result.error);
      } catch (caught) {
        return caught instanceof ManagedEnvValidationError ? error(400, caught.message) : error(500, "could not save managed env file");
      }
    }
  }

  if (route.scope === "office") {
    if (req.method === "GET") {
      try {
        return json({ mode: "managed", path: managedOfficeEnvPath(), values: readManagedOfficeEnv() });
      } catch {
        return error(500, "could not read managed env file");
      }
    }

    if (req.method === "PUT") {
      const values = await valuesFromRequest(req);
      if (values instanceof Response) return values;
      try {
        writeManagedOfficeEnv(values);
        const current = AgentManager.getOfficeSettings();
        AgentManager.setOfficeSettings(current.prompt, managedOfficeEnvPath());
        return new Response(null, { status: 204, headers: noContentHeaders });
      } catch (caught) {
        return caught instanceof ManagedEnvValidationError ? error(400, caught.message) : error(500, "could not save managed env file");
      }
    }
  }

  return error(404, "not found");
}

async function readJson(req: Request): Promise<Record<string, unknown> | Response> {
  try {
    return (await req.json()) as Record<string, unknown>;
  } catch {
    return error(400, "invalid JSON");
  }
}

function error(status: number, message: string): Response {
  return new Response(JSON.stringify({ error: message }), { status, headers: jsonHeaders });
}

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), { headers: jsonHeaders });
}

function parseEnvRoute(pathname: string): { scope: "office" } | { scope: "user"; username: string; names: boolean } | null {
  if (pathname === "/api/office/env") return { scope: "office" };
  const match = pathname.match(/^\/api\/users\/([^/]+)\/env(\/names)?$/);
  return match ? { scope: "user", username: decodeURIComponent(match[1]), names: !!match[2] } : null;
}

async function valuesFromRequest(req: Request): Promise<Record<string, string> | Response> {
  const body = await readJson(req);
  if (body instanceof Response) return body;
  const values = body && typeof body === "object" && !Array.isArray(body) ? (body as { values?: unknown }).values : null;
  if (!values || typeof values !== "object" || Array.isArray(values) || !Object.values(values).every((value) => typeof value === "string")) {
    return error(400, "values must be a string map");
  }
  return values as Record<string, string>;
}
