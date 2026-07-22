import type { ServerMessage, TaskItem } from "../../shared/types.ts";
import { generateTaskId, isValidPriority, isValidStatus } from "../../shared/types.ts";
import { readBearerToken, resolveAgentToken } from "../agents/tokens.ts";
import * as AgentManager from "../agent-manager.ts";
import type { AuthResult } from "../auth/auth-middleware.ts";
import { saveTasks } from "../persistence.ts";
import { canSeeRoom, getUserById } from "../users.ts";
import { broadcast, tasks } from "../ws/broadcast.ts";

const corsHeaders = { "Access-Control-Allow-Origin": "*", "Content-Type": "application/json" };
const createTaskIdempotency = new Map<string, string>();

/**
 * Handle every /tasks and /api/tasks request. Returns null for unrelated URLs
 * so the caller can fall through to the next router.
 */
export async function handleTasksRequest(req: Request, url: URL, auth?: AuthResult): Promise<Response | null> {
  // CORS preflight
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
  if (rawBearer && !bearer) {
    return new Response(JSON.stringify({ error: "invalid bearer token" }), { status: 401, headers: corsHeaders });
  }
  if (api && !taskAttribution(bearer, auth)) {
    return new Response(JSON.stringify({ error: "authenticated caller required" }), { status: 401, headers: corsHeaders });
  }

  // ["tasks"] or ["tasks", id] or ["tasks", id, action]
  const taskId = parts[1];
  const action = parts[2]; // "claim" or "done"

  // GET /tasks — list (excludes done and backlog by default)
  if (req.method === "GET" && !taskId) {
    const status = url.searchParams.get("status");
    const assignee = url.searchParams.get("assignee");
    const titleFilter = url.searchParams.get("title");
    let filtered = tasksForCaller(tasks, bearer, auth, api);
    if (!status) {
      filtered = filtered.filter((t) => t.status !== "done" && t.status !== "backlog");
    } else if (status !== "all") {
      filtered = filtered.filter((t) => t.status === status);
    }
    if (assignee) {
      filtered = filtered.filter((t) => t.assignee === assignee);
    }
    if (titleFilter) {
      const q = titleFilter.toLowerCase();
      filtered = filtered.filter((t) => t.title.toLowerCase().includes(q));
    }
    return new Response(JSON.stringify(filtered), { headers: corsHeaders });
  }

  // GET /tasks/:id — detail
  if (req.method === "GET" && taskId && !action) {
    const task = tasks.find((t) => t.id === taskId);
    if (!task) return new Response(JSON.stringify({ error: "not found" }), { status: 404, headers: corsHeaders });
    if (!canAccessTask(task, bearer, auth, api)) return new Response(JSON.stringify({ error: "not found" }), { status: 404, headers: corsHeaders });
    return new Response(JSON.stringify(task), { headers: corsHeaders });
  }

  // POST /tasks — create
  if (req.method === "POST" && !taskId) {
    const idempotencyCacheKey = api ? taskCreateIdempotencyKey(req, bearer, auth) : null;
    const replayedTask = idempotencyCacheKey ? tasks.find((t) => t.id === createTaskIdempotency.get(idempotencyCacheKey)) : undefined;
    if (replayedTask && canAccessTask(replayedTask, bearer, auth, true)) {
      return new Response(JSON.stringify(replayedTask), { status: 201, headers: corsHeaders });
    }
    let body: Record<string, unknown>;
    try {
      body = (await req.json()) as Record<string, unknown>;
    } catch {
      return new Response(JSON.stringify({ error: "invalid JSON" }), { status: 400, headers: corsHeaders });
    }
    const createdBy = taskAttribution(bearer, auth) ?? legacyCreatedBy(body);
    if (!body.title) {
      return new Response(JSON.stringify({ error: "title is required" }), { status: 400, headers: corsHeaders });
    }
    if (body.priority !== undefined && !isValidPriority(body.priority)) {
      return new Response(JSON.stringify({ error: "invalid priority, must be P0-P3" }), { status: 400, headers: corsHeaders });
    }
    const requestedRoomId = api && body.roomId ? String(body.roomId) : undefined;
    if (api && requestedRoomId && !canAccessRoom(requestedRoomId, bearer, auth)) {
      return new Response(JSON.stringify({ error: "not found" }), { status: 404, headers: corsHeaders });
    }
    const task: TaskItem = {
      id: generateTaskId(tasks.map((t) => t.id)),
      title: String(body.title).trim(),
      description: body.description ? String(body.description) : undefined,
      priority: body.priority as TaskItem["priority"],
      status: "open",
      assignee: body.assignee ? String(body.assignee) : undefined,
      roomId: requestedRoomId,
      createdBy,
      createdAt: Date.now(),
    };
    tasks.push(task);
    if (idempotencyCacheKey) createTaskIdempotency.set(idempotencyCacheKey, task.id);
    saveTasks(tasks);
    broadcast({ type: "tasks", tasks } as ServerMessage);
    return new Response(JSON.stringify(task), { status: 201, headers: corsHeaders });
  }

  // PATCH /tasks/:id — update
  if (req.method === "PATCH" && taskId && !action) {
    if (!taskAttribution(bearer, auth)) return new Response(JSON.stringify({ error: "authenticated caller required" }), { status: 401, headers: corsHeaders });
    const task = tasks.find((t) => t.id === taskId);
    if (!task) return new Response(JSON.stringify({ error: "not found" }), { status: 404, headers: corsHeaders });
    if (!canAccessTask(task, bearer, auth, api)) return new Response(JSON.stringify({ error: "not found" }), { status: 404, headers: corsHeaders });
    let body: Record<string, unknown>;
    try {
      body = (await req.json()) as Record<string, unknown>;
    } catch {
      return new Response(JSON.stringify({ error: "invalid JSON" }), { status: 400, headers: corsHeaders });
    }
    if (body.status !== undefined && !isValidStatus(body.status)) {
      return new Response(JSON.stringify({ error: "invalid status, must be open|in_progress|backlog|done" }), { status: 400, headers: corsHeaders });
    }
    if (body.priority !== undefined && !isValidPriority(body.priority)) {
      return new Response(JSON.stringify({ error: "invalid priority, must be P0-P3" }), { status: 400, headers: corsHeaders });
    }
    if (body.title !== undefined) task.title = String(body.title);
    if (body.description !== undefined) task.description = body.description ? String(body.description) : undefined;
    if (body.status !== undefined) task.status = body.status as TaskItem["status"];
    if (body.priority !== undefined) task.priority = body.priority ? (body.priority as TaskItem["priority"]) : undefined;
    if (body.assignee !== undefined) task.assignee = body.assignee ? String(body.assignee) : undefined;
    if (body.roomId !== undefined) {
      const requestedRoomId = body.roomId ? String(body.roomId) : undefined;
      if (requestedRoomId && !canAccessRoom(requestedRoomId, bearer, auth)) {
        return new Response(JSON.stringify({ error: "not found" }), { status: 404, headers: corsHeaders });
      }
      task.roomId = requestedRoomId;
    }
    saveTasks(tasks);
    broadcast({ type: "tasks", tasks } as ServerMessage);
    return new Response(JSON.stringify(task), { headers: corsHeaders });
  }

  // POST /tasks/:id/claim
  if (req.method === "POST" && taskId && action === "claim") {
    if (!taskAttribution(bearer, auth)) return new Response(JSON.stringify({ error: "authenticated caller required" }), { status: 401, headers: corsHeaders });
    const task = tasks.find((t) => t.id === taskId);
    if (!task) return new Response(JSON.stringify({ error: "not found" }), { status: 404, headers: corsHeaders });
    if (!canAccessTask(task, bearer, auth, api)) return new Response(JSON.stringify({ error: "not found" }), { status: 404, headers: corsHeaders });
    let body: Record<string, unknown>;
    try {
      body = (await req.json()) as Record<string, unknown>;
    } catch {
      return new Response(JSON.stringify({ error: "invalid JSON" }), { status: 400, headers: corsHeaders });
    }
    task.assignee = body.assignee ? String(body.assignee) : task.assignee;
    task.status = "in_progress";
    saveTasks(tasks);
    broadcast({ type: "tasks", tasks } as ServerMessage);
    return new Response(JSON.stringify(task), { headers: corsHeaders });
  }

  // POST /tasks/:id/done
  if (req.method === "POST" && taskId && action === "done") {
    if (!taskAttribution(bearer, auth)) return new Response(JSON.stringify({ error: "authenticated caller required" }), { status: 401, headers: corsHeaders });
    const task = tasks.find((t) => t.id === taskId);
    if (!task) return new Response(JSON.stringify({ error: "not found" }), { status: 404, headers: corsHeaders });
    if (!canAccessTask(task, bearer, auth, api)) return new Response(JSON.stringify({ error: "not found" }), { status: 404, headers: corsHeaders });
    // Agents send `curl -d '{}'` — consume the body so Bun doesn't warn
    try {
      await req.json();
    } catch {}
    task.status = "done";
    saveTasks(tasks);
    broadcast({ type: "tasks", tasks } as ServerMessage);
    return new Response(JSON.stringify(task), { headers: corsHeaders });
  }

  // DELETE /tasks/:id
  if (req.method === "DELETE" && taskId && !action) {
    if (!taskAttribution(bearer, auth)) return new Response(JSON.stringify({ error: "authenticated caller required" }), { status: 401, headers: corsHeaders });
    const index = tasks.findIndex((t) => t.id === taskId);
    if (index === -1) return new Response(JSON.stringify({ error: "not found" }), { status: 404, headers: corsHeaders });
    if (!canAccessTask(tasks[index]!, bearer, auth, api)) return new Response(JSON.stringify({ error: "not found" }), { status: 404, headers: corsHeaders });
    tasks.splice(index, 1);
    saveTasks(tasks);
    broadcast({ type: "tasks", tasks } as ServerMessage);
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  return new Response(JSON.stringify({ error: "not found" }), { status: 404, headers: corsHeaders });
}

function taskAttribution(bearer: ReturnType<typeof resolveAgentToken>, auth: AuthResult | undefined): string | null {
  if (bearer) return AgentManager.getAgentDisplay(bearer.agentId)?.name ?? bearer.agentId;
  if (auth?.kind === "ok") return getUserById(auth.session.userId)?.name ?? auth.session.username;
  return null;
}

function legacyCreatedBy(body: Record<string, unknown>): string {
  return typeof body.createdBy === "string" && body.createdBy.trim() ? body.createdBy.trim() : "Bureau";
}

function taskCreateIdempotencyKey(req: Request, bearer: ReturnType<typeof resolveAgentToken>, auth: AuthResult | undefined): string | null {
  const key = req.headers.get("Idempotency-Key")?.trim();
  if (!key) return null;
  if (bearer) return `agent:${bearer.agentId}:${key}`;
  if (auth?.kind === "ok") return `user:${auth.session.userId}:${key}`;
  return null;
}

function tasksForCaller(allTasks: TaskItem[], bearer: ReturnType<typeof resolveAgentToken>, auth: AuthResult | undefined, api: boolean): TaskItem[] {
  if (!api) return allTasks.filter((task) => !task.roomId);
  return allTasks.filter((task) => canAccessTask(task, bearer, auth, true));
}

function canAccessTask(task: TaskItem, bearer: ReturnType<typeof resolveAgentToken>, auth: AuthResult | undefined, api: boolean): boolean {
  if (!task.roomId) return true;
  if (!api) return false;
  return canAccessRoom(task.roomId, bearer, auth);
}

function canAccessRoom(roomId: string, bearer: ReturnType<typeof resolveAgentToken>, auth: AuthResult | undefined): boolean {
  const rooms = AgentManager.getRooms();
  if (!rooms.some((room) => room.id === roomId)) return false;
  if (bearer) {
    const agent = AgentManager.getAgent(bearer.agentId);
    return !!agent && rooms[agent.room]?.id === roomId;
  }
  if (auth?.kind !== "ok") return false;
  if (auth.session.role === "owner") return true;
  return canSeeRoom(getUserById(auth.session.userId), roomId);
}

function taskRouteParts(pathname: string): { parts: string[]; api: boolean } | null {
  const parts = pathname.split("/").filter(Boolean);
  if (parts[0] === "tasks") return { parts, api: false };
  if (parts[0] === "api" && parts[1] === "tasks") return { parts: parts.slice(1), api: true };
  return null;
}
