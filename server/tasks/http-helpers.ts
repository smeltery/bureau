import type { TaskItem } from "../../shared/types.ts";
import type { AuthResult } from "../auth/auth-middleware.ts";
import { resolveAgentToken } from "../agents/tokens.ts";
import * as AgentManager from "../agent-manager.ts";
import { findCronjob } from "../cronjobs/cronjob-store.ts";
import type { CronRunIdentity } from "../cronjobs/run-messaging.ts";
import { canSeeRoom, getUserById } from "../users.ts";
export const corsHeaders = { "Access-Control-Allow-Origin": "*", "Content-Type": "application/json" };
type AgentBearer = NonNullable<ReturnType<typeof resolveAgentToken>>;
export function taskAttribution(bearer: AgentBearer | null, cronRun: CronRunIdentity | null, auth: AuthResult | undefined): string | null {
  if (cronRun) return findCronjob(cronRun.cronjobId)?.name ?? cronRun.cronjobId;
  if (bearer) return AgentManager.getAgentDisplay(bearer.agentId)?.name ?? bearer.agentId;
  if (auth?.kind === "api") return `${auth.token.username} (token:${auth.token.tokenId})`;
  if (auth?.kind === "ok") return getUserById(auth.session.userId)?.name ?? auth.session.username;
  return null;
}

export function legacyCreatedBy(body: Record<string, unknown>): string {
  return typeof body.createdBy === "string" && body.createdBy.trim() ? body.createdBy.trim() : "Bureau";
}

export function readTaskRoomId(value: unknown): string | undefined | Response {
  if (value === undefined || value === "") return undefined;
  if (typeof value !== "string") return new Response(JSON.stringify({ error: "roomId must be a string" }), { status: 400, headers: corsHeaders });
  return value;
}

export function readCreateTaskRoomId(value: unknown, bearer: AgentBearer | null, cronRun: CronRunIdentity | null): string | undefined | Response {
  if (cronRun) {
    // Cron runs are globals-only: omit/"" → global; any named room → not found.
    if (value === undefined || value === "") return undefined;
    if (typeof value !== "string") return new Response(JSON.stringify({ error: "roomId must be a string" }), { status: 400, headers: corsHeaders });
    return new Response(JSON.stringify({ error: "not found" }), { status: 404, headers: corsHeaders });
  }
  if (value !== undefined) return readTaskRoomId(value);
  if (!bearer) return undefined;
  const agent = AgentManager.getAgent(bearer.agentId);
  const room = agent ? AgentManager.getRooms()[agent.room] : undefined;
  return room?.id;
}

export function taskCreateIdempotencyKey(req: Request, bearer: AgentBearer | null, cronRun: CronRunIdentity | null, auth: AuthResult | undefined): string | null {
  const key = req.headers.get("Idempotency-Key")?.trim();
  if (!key) return null;
  if (cronRun) return `cron:${cronRun.cronjobId}:${cronRun.runId}:${key}`;
  if (bearer) return `agent:${bearer.agentId}:${key}`;
  if (auth?.kind === "api") return `token:${auth.token.tokenId}:${key}`;
  if (auth?.kind === "ok") return `user:${auth.session.userId}:${key}`;
  return null;
}

export function tasksForCaller(allTasks: TaskItem[], bearer: AgentBearer | null, cronRun: CronRunIdentity | null, auth: AuthResult | undefined, api: boolean): TaskItem[] {
  if (!api) return allTasks.filter((task) => !task.roomId);
  return allTasks.filter((task) => canAccessTask(task, bearer, cronRun, auth, true));
}

export function canAccessTask(task: TaskItem, bearer: AgentBearer | null, cronRun: CronRunIdentity | null, auth: AuthResult | undefined, api: boolean): boolean {
  if (!task.roomId) return true;
  if (!api) return false;
  return canAccessRoom(task.roomId, bearer, cronRun, auth);
}

export function canAccessRoom(roomId: string, bearer: AgentBearer | null, cronRun: CronRunIdentity | null, auth: AuthResult | undefined): boolean {
  const rooms = AgentManager.getRooms();
  if (!rooms.some((room) => room.id === roomId)) return false;
  // Cron runs inherited the legacy globals-only board: no room tasks.
  if (cronRun) return false;
  if (bearer) {
    // Prefer the manager's accessible rooms when the manager still exists;
    // otherwise fall back to the agent's own room.
    if (bearer.userId) {
      const manager = getUserById(bearer.userId);
      if (manager) return canSeeRoom(manager, roomId);
    }
    const agent = AgentManager.getAgent(bearer.agentId);
    return !!agent && rooms[agent.room]?.id === roomId;
  }
  if (auth?.kind === "api") return auth.token.role === "owner" || (!!getUserById(auth.token.userId) && canSeeRoom(getUserById(auth.token.userId), roomId));
  if (auth?.kind !== "ok") return false;
  if (auth.session.role === "owner") return true;
  return !!getUserById(auth.session.userId) && canSeeRoom(getUserById(auth.session.userId), roomId);
}

export function taskRouteParts(pathname: string): { parts: string[]; api: boolean } | null {
  const parts = pathname.split("/").filter(Boolean);
  if (parts[0] === "tasks") return { parts, api: false };
  if (parts[0] === "api" && parts[1] === "tasks") return { parts: parts.slice(1), api: true };
  return null;
}

type VersionedTask = TaskItem & { version: string };

/** Content hash of a task: any field change yields a new version. */
function taskVersion(task: TaskItem): string {
  const fields = Object.entries(task)
    .filter(([key, value]) => key !== "version" && value !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return Bun.hash(JSON.stringify(fields)).toString(36);
}

export function withVersion(task: TaskItem): VersionedTask {
  return { ...task, version: taskVersion(task) };
}

/**
 * Optimistic-concurrency check for a task edit. A request without `version`
 * is accepted as-is; a malformed one is a 400 and a stale one a 409 carrying
 * the current task so the caller can re-apply its change.
 */
export function versionMismatch(task: TaskItem, requested: unknown): { status: 400 | 409; body: Record<string, unknown> } | null {
  if (requested === undefined) return null;
  if (typeof requested !== "string" || requested.length === 0) {
    return { status: 400, body: { error: "version must be the non-empty string from a read of the task" } };
  }
  const current = taskVersion(task);
  if (requested === current) return null;
  return { status: 409, body: { error: "version conflict: the task changed since your read; re-read and retry", version: current, task: withVersion(task) } };
}
