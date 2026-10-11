import {
  taskAttribution,
  legacyCreatedBy,
  readTaskRoomId,
  readCreateTaskRoomId,
  taskCreateIdempotencyKey,
  tasksForCaller,
  canAccessTask,
  canAccessRoom,
  taskRouteParts,
  withVersion,
  versionMismatch,
  corsHeaders,
} from "../tasks/http-helpers.ts";
import { taskHistoryResponse } from "../tasks/history-http.ts";
import { privilegedAgentIdentity } from "./agent-route-helpers.ts";
import { taskStore, TaskStoreError } from "../tasks/store.ts";
import type { ServerMessage, TaskItem } from "../../shared/types.ts";
import { generateTaskId, isValidPriority, isValidStatus } from "../../shared/types.ts";
import { readBearerToken, resolveAgentToken } from "../agents/tokens.ts";
import type { AuthResult } from "../auth/auth-middleware.ts";
import { resolveCronRunBearer } from "../cronjobs/run-messaging.ts";
import { broadcast, tasks } from "../ws/broadcast.ts";

const createTaskIdempotency = new Map<string, string>();

/**
 * Handle every /tasks and /api/tasks request. Returns null for unrelated URLs
 * so the caller can fall through to the next router.
 */
export async function handleTasksRequest(req: Request, url: URL, auth?: AuthResult): Promise<Response | null> {
  try {
    return await routeTasks(req, url, auth);
  } catch (error) {
    console.error("[tasks]", error);
    return Response.json({ error: error instanceof TaskStoreError ? error.message : "Unable to persist task changes" }, { status: error instanceof TaskStoreError ? error.status : 500 });
  }
}
async function routeTasks(req: Request, url: URL, auth?: AuthResult): Promise<Response | null> {
  if (req.method === "OPTIONS" && (url.pathname.startsWith("/tasks") || url.pathname.startsWith("/api/tasks"))) {
    return new Response(null, {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS",
        "Access-Control-Allow-Headers": "Authorization, Content-Type",
      },
    });
  }

  const route = taskRouteParts(url.pathname);
  if (!route) return null;
  const { parts, api } = route;
  const rawBearer = readBearerToken(req);
  const bearer = resolveAgentToken(rawBearer);
  const cronRun = !bearer ? resolveCronRunBearer(rawBearer) : null;
  if (rawBearer && !bearer && !cronRun && auth?.kind !== "api") {
    return new Response(JSON.stringify({ error: "invalid bearer token" }), { status: 401, headers: corsHeaders });
  }
  if (api && !taskAttribution(bearer, cronRun, auth)) {
    return new Response(JSON.stringify({ error: "authenticated caller required" }), { status: 401, headers: corsHeaders });
  }

  const taskId = parts[1];
  const action = parts[2];
  if (api) {
    const owner = bearer ? privilegedAgentIdentity(req)?.manager.role === "owner" : auth?.kind === "ok" ? auth.session.role === "owner" : auth?.kind === "api" && auth.token.role === "owner";
    const history = taskHistoryResponse(req, url, taskId, action, owner, taskAttribution(bearer, cronRun, auth), (task) => canAccessTask(task, bearer, cronRun, auth, true));
    if (history) return history;
  }

  if (req.method === "GET" && !taskId) {
    const status = url.searchParams.get("status");
    const assignee = url.searchParams.get("assignee");
    const titleFilter = url.searchParams.get("title");
    const roomFilter = url.searchParams.get("roomId");
    let filtered = tasksForCaller(tasks, bearer, cronRun, auth, api);
    if (roomFilter !== null) {
      if (roomFilter.length === 0) {
        filtered = filtered.filter((t) => !t.roomId);
      } else if (canAccessRoom(roomFilter, bearer, cronRun, auth)) {
        filtered = filtered.filter((t) => t.roomId === roomFilter);
      } else {
        return new Response(JSON.stringify({ error: "not found" }), { status: 404, headers: corsHeaders });
      }
    }
    if (!status) {
      filtered = filtered.filter((t) => t.status === "open" || t.status === "in_progress");
    } else if (status !== "all") {
      filtered = filtered.filter((t) => t.status === status);
    }
    if (assignee) filtered = filtered.filter((t) => t.assignee === assignee);
    if (titleFilter) {
      const q = titleFilter.toLowerCase();
      filtered = filtered.filter((t) => t.title.toLowerCase().includes(q));
    }
    return new Response(JSON.stringify(filtered.map(withVersion)), { headers: corsHeaders });
  }

  if (req.method === "GET" && taskId && !action) {
    const task = tasks.find((t) => t.id === taskId);
    if (!task) return new Response(JSON.stringify({ error: "not found" }), { status: 404, headers: corsHeaders });
    if (!canAccessTask(task, bearer, cronRun, auth, api)) return new Response(JSON.stringify({ error: "not found" }), { status: 404, headers: corsHeaders });
    return new Response(JSON.stringify(withVersion(task)), { headers: corsHeaders });
  }

  if (req.method === "POST" && !taskId) {
    const idempotencyCacheKey = api ? taskCreateIdempotencyKey(req, bearer, cronRun, auth) : null;
    const replayedTask = idempotencyCacheKey ? tasks.find((t) => t.id === createTaskIdempotency.get(idempotencyCacheKey)) : undefined;
    if (replayedTask && canAccessTask(replayedTask, bearer, cronRun, auth, true)) {
      return new Response(JSON.stringify(withVersion(replayedTask)), { status: 201, headers: corsHeaders });
    }
    let body: Record<string, unknown>;
    try {
      body = (await req.json()) as Record<string, unknown>;
    } catch {
      return new Response(JSON.stringify({ error: "invalid JSON" }), { status: 400, headers: corsHeaders });
    }
    const createdBy = taskAttribution(bearer, cronRun, auth) ?? legacyCreatedBy(body);
    if (!body.title) return new Response(JSON.stringify({ error: "title is required" }), { status: 400, headers: corsHeaders });
    if (body.priority !== undefined && !isValidPriority(body.priority)) {
      return new Response(JSON.stringify({ error: "invalid priority, must be P0-P3" }), { status: 400, headers: corsHeaders });
    }
    const requestedRoomId = api ? readCreateTaskRoomId(body.roomId, bearer, cronRun) : undefined;
    if (requestedRoomId instanceof Response) return requestedRoomId;
    if (api && requestedRoomId && !canAccessRoom(requestedRoomId, bearer, cronRun, auth)) {
      return new Response(JSON.stringify({ error: "not found" }), { status: 404, headers: corsHeaders });
    }
    const task: TaskItem = {
      id: generateTaskId([...tasks.map((t) => t.id), ...taskStore.ids()]),
      title: String(body.title).trim(),
      description: body.description ? String(body.description) : undefined,
      priority: body.priority as TaskItem["priority"],
      status: "open",
      assignee: body.assignee ? String(body.assignee) : undefined,
      roomId: requestedRoomId,
      createdBy,
      createdAt: Date.now(),
    };
    taskStore.commit(null, task, taskAttribution(bearer, cronRun, auth) ?? "local");
    tasks.push(task);
    if (idempotencyCacheKey) createTaskIdempotency.set(idempotencyCacheKey, task.id);
    broadcast({ type: "tasks", tasks } as ServerMessage);
    return new Response(JSON.stringify(withVersion(task)), { status: 201, headers: corsHeaders });
  }

  if (req.method === "PATCH" && taskId && !action) {
    if (!taskAttribution(bearer, cronRun, auth)) return new Response(JSON.stringify({ error: "authenticated caller required" }), { status: 401, headers: corsHeaders });
    const before = tasks.find((t) => t.id === taskId);
    const task = before ? { ...before } : undefined;
    if (!task) return new Response(JSON.stringify({ error: "not found" }), { status: 404, headers: corsHeaders });
    if (!canAccessTask(task, bearer, cronRun, auth, api)) return new Response(JSON.stringify({ error: "not found" }), { status: 404, headers: corsHeaders });
    let body: Record<string, unknown>;
    try {
      body = (await req.json()) as Record<string, unknown>;
    } catch {
      return new Response(JSON.stringify({ error: "invalid JSON" }), { status: 400, headers: corsHeaders });
    }
    if (body.status !== undefined && !isValidStatus(body.status)) {
      return new Response(JSON.stringify({ error: "invalid status, must be open|in_progress|backlog|done|obsolete" }), { status: 400, headers: corsHeaders });
    }
    if (body.priority !== undefined && body.priority !== null && !isValidPriority(body.priority)) {
      return new Response(JSON.stringify({ error: "invalid priority, must be P0-P3 or null to clear" }), { status: 400, headers: corsHeaders });
    }
    const stale = versionMismatch(task, body.version);
    if (stale) return new Response(JSON.stringify(stale.body), { status: stale.status, headers: corsHeaders });
    if (body.title !== undefined) task.title = String(body.title);
    if (body.description !== undefined) task.description = body.description ? String(body.description) : undefined;
    if (body.status !== undefined) task.status = body.status as TaskItem["status"];
    if (body.priority !== undefined) {
      if (body.priority === null) delete task.priority;
      else task.priority = body.priority as TaskItem["priority"];
    }
    if (body.assignee !== undefined) task.assignee = body.assignee ? String(body.assignee) : undefined;
    if (body.roomId !== undefined) {
      const requestedRoomId = readTaskRoomId(body.roomId);
      if (requestedRoomId instanceof Response) return requestedRoomId;
      if (requestedRoomId && !canAccessRoom(requestedRoomId, bearer, cronRun, auth)) {
        return new Response(JSON.stringify({ error: "not found" }), { status: 404, headers: corsHeaders });
      }
      task.roomId = requestedRoomId;
    }
    taskStore.commit(before!, task, taskAttribution(bearer, cronRun, auth)!);
    tasks[tasks.findIndex((t) => t.id === taskId)] = task;
    broadcast({ type: "tasks", tasks } as ServerMessage);
    return new Response(JSON.stringify(withVersion(task)), { headers: corsHeaders });
  }

  if (req.method === "POST" && taskId && action === "claim") {
    if (!taskAttribution(bearer, cronRun, auth)) return new Response(JSON.stringify({ error: "authenticated caller required" }), { status: 401, headers: corsHeaders });
    const before = tasks.find((t) => t.id === taskId);
    const task = before ? { ...before } : undefined;
    if (!task) return new Response(JSON.stringify({ error: "not found" }), { status: 404, headers: corsHeaders });
    if (!canAccessTask(task, bearer, cronRun, auth, api)) return new Response(JSON.stringify({ error: "not found" }), { status: 404, headers: corsHeaders });
    let body: Record<string, unknown>;
    try {
      body = (await req.json()) as Record<string, unknown>;
    } catch {
      return new Response(JSON.stringify({ error: "invalid JSON" }), { status: 400, headers: corsHeaders });
    }
    const claimant = typeof body.assignee === "string" && body.assignee.length > 0 ? body.assignee : undefined;
    if (task.assignee && task.assignee !== claimant) {
      const error = `task held by ${task.assignee}; to reassign it, PATCH assignee with the task's version`;
      return new Response(JSON.stringify({ error, assignee: task.assignee }), { status: 409, headers: corsHeaders });
    }
    if (claimant) task.assignee = claimant;
    task.status = "in_progress";
    taskStore.commit(before!, task, taskAttribution(bearer, cronRun, auth)!);
    tasks[tasks.findIndex((t) => t.id === taskId)] = task;
    broadcast({ type: "tasks", tasks } as ServerMessage);
    return new Response(JSON.stringify(withVersion(task)), { headers: corsHeaders });
  }

  if (req.method === "POST" && taskId && action === "done") {
    if (!taskAttribution(bearer, cronRun, auth)) return new Response(JSON.stringify({ error: "authenticated caller required" }), { status: 401, headers: corsHeaders });
    const before = tasks.find((t) => t.id === taskId);
    const task = before ? { ...before } : undefined;
    if (!task) return new Response(JSON.stringify({ error: "not found" }), { status: 404, headers: corsHeaders });
    if (!canAccessTask(task, bearer, cronRun, auth, api)) return new Response(JSON.stringify({ error: "not found" }), { status: 404, headers: corsHeaders });
    try {
      await req.json();
    } catch {}
    task.status = "done";
    taskStore.commit(before!, task, taskAttribution(bearer, cronRun, auth)!);
    tasks[tasks.findIndex((t) => t.id === taskId)] = task;
    broadcast({ type: "tasks", tasks } as ServerMessage);
    return new Response(JSON.stringify(withVersion(task)), { headers: corsHeaders });
  }

  if (req.method === "DELETE" && taskId && !action) {
    if (!api) return new Response(JSON.stringify({ error: "method not allowed" }), { status: 405, headers: corsHeaders });
    // Cron runs may file and complete tasks, but not erase them.
    if (cronRun) return new Response(JSON.stringify({ error: "forbidden" }), { status: 403, headers: corsHeaders });
    if (!taskAttribution(bearer, cronRun, auth)) return new Response(JSON.stringify({ error: "authenticated caller required" }), { status: 401, headers: corsHeaders });
    const index = tasks.findIndex((t) => t.id === taskId);
    if (index === -1) return new Response(JSON.stringify({ error: "not found" }), { status: 404, headers: corsHeaders });
    if (!canAccessTask(tasks[index]!, bearer, cronRun, auth, api)) return new Response(JSON.stringify({ error: "not found" }), { status: 404, headers: corsHeaders });
    taskStore.commit(tasks[index]!, null, taskAttribution(bearer, cronRun, auth)!);
    tasks.splice(index, 1);
    broadcast({ type: "tasks", tasks } as ServerMessage);
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  return new Response(JSON.stringify({ error: "not found" }), { status: 404, headers: corsHeaders });
}
