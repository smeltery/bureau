import { privilegedAgentIdentity } from "./agent-route-helpers.ts";
import { readBearerToken } from "../agents/tokens.ts";
import { resolveApiToken } from "../auth/api-tokens.ts";
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
import { normalizeExperimental, normalizeReceptionistAgentId } from "../persistence/config/office-config.ts";
import { validMemberShare } from "../../shared/member-usage/share.ts";
import { memberUsageCap } from "../usage-cap/member-usage-cap.ts";

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
  const bearer = readBearerToken(req);
  const ownerAuthorized = () =>
    bearer ? (auth.kind === "api" ? resolveApiToken(bearer)?.role === "owner" : privilegedAgentIdentity(req)?.manager.role === "owner") : auth.kind === "ok" && auth.session.role === "owner";
  if (!ownerAuthorized()) return error(auth.kind === "ok" || bearer ? 403 : 401, auth.kind === "ok" || bearer ? "owner access required" : "authenticated browser session required");

  if (req.method === "GET") {
    const settings = AgentManager.getOfficeSettings();
    const memberUsageStatus = settings.memberUsageCap ? await memberUsageCap().status() : undefined;
    if (!ownerAuthorized()) return error(403, "owner access required");
    const wire = bearer ? { prompt: settings.prompt, officeName: settings.officeName, memberUsageCap: settings.memberUsageCap, memberUsageShare: settings.memberUsageShare } : settings;
    return new Response(JSON.stringify({ ...wire, memberUsageStatus, version: AgentManager.officeSettingsVersion(settings) }), { headers: { ...jsonHeaders, "Cache-Control": "no-store" } });
  }

  if (req.method === "PUT") {
    const body = await readJson(req);
    if (body instanceof Response) return body;
    if (!ownerAuthorized()) return error(403, "owner access required");
    if (bearer && Object.keys(body).some((key) => !["version", "prompt", "officeName", "memberUsageCap", "memberUsageShare"].includes(key))) return error(400, "unsupported office settings field");
    // Version guard before field validation — stale writers re-read first.
    const version = typeof body.version === "string" ? body.version : "";
    if (!version) return error(400, "settings version is required");
    const current = AgentManager.getOfficeSettings();
    const currentVersion = AgentManager.officeSettingsVersion(current);
    if (version !== currentVersion) {
      return error(409, "office settings changed; fetch the latest version and retry", { version: currentVersion });
    }
    if (body.prompt !== undefined && body.prompt !== null && typeof body.prompt !== "string") return error(400, "prompt must be text or null");
    if (typeof body.prompt === "string" && Buffer.byteLength(body.prompt) > 64 * 1024) return error(400, "prompt is too long");
    if (body.officeName !== undefined && body.officeName !== null && (typeof body.officeName !== "string" || body.officeName.trim().length > 64))
      return error(400, "officeName must be at most 64 characters or null");
    const officeName = body.officeName === undefined ? current.officeName : typeof body.officeName === "string" ? body.officeName.trim() || null : null;
    const prompt = body.prompt === undefined ? current.prompt : typeof body.prompt === "string" ? body.prompt : null;
    const envFile = body.envFile === undefined ? current.envFile : typeof body.envFile === "string" && body.envFile.trim() ? body.envFile.trim() : null;
    if (envFile) {
      try {
        AgentManager.validateEnvPath(envFile);
      } catch (err) {
        return error(422, err instanceof Error ? err.message : "invalid env file");
      }
    }
    let experimental = current.experimental;
    if (body.experimental !== undefined) {
      const parsed = normalizeExperimental(body.experimental);
      if (!parsed) return error(400, "experimental must be { browserPanel: boolean }");
      experimental = parsed;
    }
    let receptionistAgentId = current.receptionistAgentId;
    if (body.receptionistAgentId !== undefined) {
      if (body.receptionistAgentId !== null && typeof body.receptionistAgentId !== "string") {
        return error(400, "receptionistAgentId must be a string or null");
      }
      receptionistAgentId = normalizeReceptionistAgentId(body.receptionistAgentId) ?? null;
    }
    let memberUsageCap = current.memberUsageCap ?? false;
    if (body.memberUsageCap !== undefined) {
      if (typeof body.memberUsageCap !== "boolean") return error(400, "memberUsageCap must be a boolean");
      memberUsageCap = body.memberUsageCap;
    }
    let memberUsageShare = current.memberUsageShare;
    if (body.memberUsageShare !== undefined) {
      if (!validMemberShare(body.memberUsageShare)) return error(400, "memberUsageShare must be 10..100 in steps of 10");
      memberUsageShare = body.memberUsageShare;
    }
    AgentManager.setOfficeSettings(prompt, envFile, experimental, receptionistAgentId, memberUsageCap, memberUsageShare, officeName);
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
    const body = await req.json();
    return body && typeof body === "object" && !Array.isArray(body) ? (body as Record<string, unknown>) : error(400, "body must be an object");
  } catch {
    return error(400, "invalid JSON");
  }
}

function error(status: number, message: string, extra?: Record<string, unknown>): Response {
  return new Response(JSON.stringify({ error: message, ...extra }), { status, headers: jsonHeaders });
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
