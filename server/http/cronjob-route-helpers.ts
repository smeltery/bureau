import type { AuthOk, AuthResult } from "../auth/auth-middleware.ts";
import * as AgentManager from "../agent-manager.ts";
import { privilegedAgentIdentity } from "./agent-route-helpers.ts";
import * as CronjobManager from "../cronjobs/index.ts";
import type { AgentBackendType, CodexSandboxMode, Cronjob, CronjobPermissionMode, EffortLevel, Schedule } from "../../shared/types.ts";

export const cronjobCorsHeaders = { "Access-Control-Allow-Origin": "*", "Content-Type": "application/json" };

export type CronjobCaller = {
  session: { username: string; userId: string; role: AuthOk["session"]["role"] | "privileged_agent" };
};

export function browserSessionOrError(auth: AuthResult | undefined): AuthOk | Response {
  return auth?.kind === "ok" ? auth : jsonError(401, "authenticated browser session required");
}

/**
 * Browser-session owner/member-owner gate, OR a privileged agent whose manager
 * owns the job. Create callers pass no cronjob; mutations pass the target.
 * Office cron prompt stays browser-owner-only (see cronjobs.ts).
 */
export function cronjobCallerOrError(req: Request, auth: AuthResult | undefined, cronjob?: Cronjob): CronjobCaller | Response {
  if (auth?.kind === "ok") {
    if (!cronjob || auth.session.role === "owner" || cronjob.userId === auth.session.userId) {
      return { session: { username: auth.session.username, userId: auth.session.userId, role: auth.session.role } };
    }
    return jsonError(403, "owner access required");
  }
  const operator = privilegedAgentIdentity(req);
  if (!operator) return jsonError(401, "authenticated browser session required");
  if (cronjob && cronjob.userId !== operator.manager.id) return jsonError(403, "owner access required");
  const agent = AgentManager.getAgent(operator.agentId);
  return {
    session: {
      username: agent?.name ?? operator.manager.name,
      userId: operator.manager.id,
      role: "privileged_agent",
    },
  };
}

/** @deprecated Prefer cronjobCallerOrError — kept name as thin wrapper for browser-only call sites. */
export function cronjobOwnerOrError(auth: AuthResult | undefined, cronjob: Cronjob): AuthOk | Response {
  const caller = browserSessionOrError(auth);
  if (caller instanceof Response) return caller;
  if (caller.session.role === "owner" || cronjob.userId === caller.session.userId) return caller;
  return jsonError(403, "owner access required");
}

export async function readJson(req: Request): Promise<Record<string, unknown> | Response> {
  try {
    const body = await req.json();
    return body && typeof body === "object" && !Array.isArray(body) ? (body as Record<string, unknown>) : jsonError(400, "invalid JSON");
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

export type CronjobCreateDraft = Omit<Parameters<typeof CronjobManager.addCronjob>[0], "username" | "userId">;
type Weekday = Extract<Schedule, { type: "weekly" }>["weekday"];

export function parseCronjobCreate(body: Record<string, unknown>): { ok: true; draft: CronjobCreateDraft } | { ok: false; error: string } {
  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (!name) return { ok: false, error: "name is required" };
  if (typeof body.prompt !== "string") return { ok: false, error: "prompt is required" };
  const cwd = typeof body.cwd === "string" ? body.cwd.trim() : "";
  if (!cwd) return { ok: false, error: "cwd is required" };
  if (body.schedule === undefined || body.modelFamily === undefined) return { ok: false, error: "schedule and modelFamily are required" };
  if (body.effort === undefined || body.permissionMode === undefined) return { ok: false, error: "effort and permissionMode are required" };
  const schedule = parseSchedule(body.schedule);
  if (!schedule) return { ok: false, error: "schedule must be daily, weekly, or interval with finite numeric fields" };
  const agentType = parseAgentType(body.agentType);
  if (body.agentType !== undefined && !agentType) return { ok: false, error: "agentType must be claude or codex" };
  if (typeof body.modelFamily !== "string" || !body.modelFamily.trim()) return { ok: false, error: "modelFamily must be a string" };
  const effort = parseEffort(body.effort);
  if (!effort) return { ok: false, error: "effort must be a string" };
  const permissionMode = parsePermissionMode(body.permissionMode);
  if (!permissionMode) return { ok: false, error: "permissionMode must be never or bypassPermissions" };
  const codexSandbox = parseCodexSandbox(body.codexSandbox);
  if (body.codexSandbox !== undefined && !codexSandbox) return { ok: false, error: "codexSandbox must be read-only, workspace-write, or danger-full-access" };
  return {
    ok: true,
    draft: {
      name,
      schedule,
      prompt: body.prompt,
      cwd,
      agentType,
      modelFamily: body.modelFamily,
      effort,
      permissionMode,
      ...(codexSandbox ? { codexSandbox } : {}),
    },
  };
}

export function parseCronjobChanges(body: Record<string, unknown>): { ok: true; changes: Parameters<typeof CronjobManager.updateCronjob>[1] } | { ok: false; error: string } {
  const changes: Parameters<typeof CronjobManager.updateCronjob>[1] = {};
  if (typeof body.name === "string") changes.name = body.name;
  if (body.schedule !== undefined) {
    const schedule = parseSchedule(body.schedule);
    if (!schedule) return { ok: false, error: "schedule must be daily, weekly, or interval with finite numeric fields" };
    changes.schedule = schedule;
  }
  if (typeof body.prompt === "string") changes.prompt = body.prompt;
  if (typeof body.cwd === "string") changes.cwd = body.cwd;
  const agentType = parseAgentType(body.agentType);
  if (body.agentType !== undefined && !agentType) return { ok: false, error: "agentType must be claude or codex" };
  if (agentType) changes.agentType = agentType;
  if (typeof body.modelFamily === "string") changes.modelFamily = body.modelFamily;
  if (body.effort !== undefined) {
    const effort = parseEffort(body.effort);
    if (!effort) return { ok: false, error: "effort must be a string" };
    changes.effort = effort;
  }
  if (body.permissionMode !== undefined) {
    const permissionMode = parsePermissionMode(body.permissionMode);
    if (!permissionMode) return { ok: false, error: "permissionMode must be never or bypassPermissions" };
    changes.permissionMode = permissionMode;
  }
  if (body.codexSandbox !== undefined) {
    const codexSandbox = parseCodexSandbox(body.codexSandbox);
    if (!codexSandbox) return { ok: false, error: "codexSandbox must be read-only, workspace-write, or danger-full-access" };
    changes.codexSandbox = codexSandbox;
  }
  if (typeof body.enabled === "boolean") changes.enabled = body.enabled;
  return { ok: true, changes };
}

function parseSchedule(value: unknown): Schedule | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const schedule = value as Record<string, unknown>;
  if (schedule.type === "interval" && isFiniteNumber(schedule.minutes)) return { type: "interval", minutes: schedule.minutes };
  if (schedule.type === "daily" && isFiniteNumber(schedule.hour) && isFiniteNumber(schedule.minute)) return { type: "daily", hour: schedule.hour, minute: schedule.minute };
  if (schedule.type === "weekly" && isFiniteNumber(schedule.weekday) && isFiniteNumber(schedule.hour) && isFiniteNumber(schedule.minute))
    return { type: "weekly", weekday: schedule.weekday as Weekday, hour: schedule.hour, minute: schedule.minute };
  return null;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function parseAgentType(value: unknown): AgentBackendType | undefined {
  if (value === undefined) return undefined;
  return value === "claude" || value === "codex" ? value : undefined;
}

function parseEffort(value: unknown): EffortLevel | undefined {
  return typeof value === "string" && value.trim() ? (value as EffortLevel) : undefined;
}

function parsePermissionMode(value: unknown): CronjobPermissionMode | undefined {
  return value === "never" || value === "bypassPermissions" ? value : undefined;
}

function parseCodexSandbox(value: unknown): CodexSandboxMode | undefined {
  if (value === undefined) return undefined;
  return value === "read-only" || value === "workspace-write" || value === "danger-full-access" ? value : undefined;
}

export function cronjobRouteParts(pathname: string): string[] | null {
  const parts = pathname.split("/").filter(Boolean);
  if (parts[0] === "cronjobs") return parts;
  if (parts[0] === "api" && parts[1] === "cronjobs") return parts.slice(1);
  return null;
}
