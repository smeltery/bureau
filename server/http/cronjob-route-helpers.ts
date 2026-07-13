import type { AuthOk, AuthResult } from "../auth/auth-middleware.ts";
import * as AgentManager from "../agent-manager.ts";
import * as CronjobManager from "../cronjobs/index.ts";
import type { Cronjob } from "../../shared/types.ts";

export const cronjobCorsHeaders = { "Access-Control-Allow-Origin": "*", "Content-Type": "application/json" };

export function browserSessionOrError(auth: AuthResult | undefined): AuthOk | Response {
  return auth?.kind === "ok" ? auth : jsonError(401, "authenticated browser session required");
}

export function cronjobOwnerOrError(auth: AuthResult | undefined, cronjob: Cronjob): AuthOk | Response {
  const caller = browserSessionOrError(auth);
  if (caller instanceof Response) return caller;
  if (caller.session.role === "owner" || cronjob.userId === caller.session.userId) return caller;
  return jsonError(403, "owner access required");
}

export async function readJson(req: Request): Promise<Record<string, unknown> | Response> {
  try {
    return (await req.json()) as Record<string, unknown>;
  } catch {
    return jsonError(400, "invalid JSON");
  }
}

export function jsonError(status: number, error: string): Response {
  return new Response(JSON.stringify({ error }), { status, headers: cronjobCorsHeaders });
}

export function validateCwdForRequest(cwd: string): string | null {
  try {
    AgentManager.validateCwd(cwd);
    return null;
  } catch (err) {
    return err instanceof Error ? err.message : "invalid directory";
  }
}

export function validateCronjobCreate(body: Record<string, unknown>): string | null {
  if (typeof body.name !== "string" || !body.name.trim()) return "name is required";
  if (typeof body.prompt !== "string") return "prompt is required";
  if (typeof body.cwd !== "string" || !body.cwd.trim()) return "cwd is required";
  if (body.schedule === undefined || body.modelFamily === undefined) return "schedule and modelFamily are required";
  if (body.effort === undefined || body.permissionMode === undefined) return "effort and permissionMode are required";
  return null;
}

export function pickCronjobChanges(body: Record<string, unknown>): Parameters<typeof CronjobManager.updateCronjob>[1] {
  const changes: Parameters<typeof CronjobManager.updateCronjob>[1] = {};
  if (typeof body.name === "string") changes.name = body.name;
  if (body.schedule !== undefined) changes.schedule = body.schedule as Cronjob["schedule"];
  if (typeof body.prompt === "string") changes.prompt = body.prompt;
  if (typeof body.cwd === "string") changes.cwd = body.cwd;
  if (typeof body.modelFamily === "string") changes.modelFamily = body.modelFamily;
  if (typeof body.effort === "string") changes.effort = body.effort as Cronjob["effort"];
  if (typeof body.permissionMode === "string") changes.permissionMode = body.permissionMode as Cronjob["permissionMode"];
  if (typeof body.codexSandbox === "string") changes.codexSandbox = body.codexSandbox as Cronjob["codexSandbox"];
  if (typeof body.enabled === "boolean") changes.enabled = body.enabled;
  return changes;
}

export function cronjobRouteParts(pathname: string): string[] | null {
  const parts = pathname.split("/").filter(Boolean);
  if (parts[0] === "cronjobs") return parts;
  if (parts[0] === "api" && parts[1] === "cronjobs") return parts.slice(1);
  return null;
}
