import type { AuthResult } from "../auth/auth-middleware.ts";
import * as AgentManager from "../agent-manager.ts";
import { getUserById, getUserByName } from "../users.ts";

const jsonHeaders = { "Access-Control-Allow-Origin": "*", "Content-Type": "application/json" };

export async function handleValidateRequest(req: Request, url: URL, auth: AuthResult): Promise<Response | null> {
  if (req.method === "OPTIONS" && url.pathname.startsWith("/api/validate/")) {
    return new Response(null, {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "Authorization, Content-Type",
      },
    });
  }

  if (!url.pathname.startsWith("/api/validate/")) return null;
  if (auth.kind !== "ok") return json({ ok: false, error: "authenticated browser session required" }, 401);

  const parts = url.pathname.split("/").filter(Boolean);
  const action = parts[2];
  if (req.method !== "POST") return json({ ok: false, error: "not found" }, 404);

  if (action === "cwd") {
    const body = await readJson(req);
    if (body instanceof Response) return body;
    const cwd = typeof body.cwd === "string" ? body.cwd : "";
    if (!cwd.trim()) return json({ ok: false, error: "cwd is required" });
    try {
      AgentManager.validateCwd(cwd);
      return json({ ok: true });
    } catch (err) {
      return json({ ok: false, error: err instanceof Error ? err.message : "invalid directory" });
    }
  }

  if (action === "env") {
    const body = await readJson(req);
    if (body instanceof Response) return body;
    const resolved = resolveEnvFile(body, auth);
    if (!resolved.ok) return json({ ok: false, error: resolved.error }, resolved.status);
    if (!resolved.envFile) return json({ ok: true });
    try {
      const keyCount = AgentManager.validateEnvPath(resolved.envFile);
      return json({ ok: true, keyCount });
    } catch (err) {
      return json({ ok: false, error: err instanceof Error ? err.message : "invalid env file" });
    }
  }

  return json({ ok: false, error: "not found" }, 404);
}

async function readJson(req: Request): Promise<Record<string, unknown> | Response> {
  try {
    return (await req.json()) as Record<string, unknown>;
  } catch {
    return json({ ok: false, error: "invalid JSON" }, 400);
  }
}

function resolveEnvFile(body: Record<string, unknown>, auth: AuthResult): { ok: true; envFile: string | null } | { ok: false; status: number; error: string } {
  if (auth.kind !== "ok") return { ok: false, status: 401, error: "authenticated browser session required" };
  const scope = typeof body.scope === "string" ? body.scope : "";
  if (scope === "office") {
    if (auth.session.role !== "owner") return { ok: false, status: 403, error: "owner access required" };
    return { ok: true, envFile: AgentManager.getOfficeSettings().envFile };
  }
  if (scope === "room") {
    if (auth.session.role !== "owner") return { ok: false, status: 403, error: "owner access required" };
    const roomId = typeof body.roomId === "string" ? body.roomId : "";
    const room = AgentManager.getRooms().find((r) => r.id === roomId);
    return { ok: true, envFile: room?.envFile ?? null };
  }
  if (scope === "user") {
    const username = typeof body.username === "string" ? body.username : undefined;
    const target = username ? getUserByName(username) : getUserById(auth.session.userId);
    if (!target) return { ok: true, envFile: null };
    if (auth.session.role !== "owner" && target.id !== auth.session.userId) {
      return { ok: false, status: 403, error: "user env validation is not allowed" };
    }
    const envFile = typeof body.envFile === "string" ? body.envFile.trim() || null : target.envFile;
    return { ok: true, envFile };
  }
  return { ok: false, status: 422, error: "scope must be office, room, or user" };
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: jsonHeaders });
}
