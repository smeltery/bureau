import type { ServerMessage, TaskItem } from "../../shared/types.ts";
import { generateTaskId, isValidPriority, isValidStatus } from "../../shared/types.ts";
import { saveTasks } from "../persistence.ts";
import { broadcast, tasks } from "../ws/broadcast.ts";

const corsHeaders = { "Access-Control-Allow-Origin": "*", "Content-Type": "application/json" };

/**
 * Handle every /tasks request. Returns null for any non-tasks URL so the
 * caller can fall through to the next router.
 */
export async function handleTasksRequest(req: Request, url: URL): Promise<Response | null> {
  // CORS preflight
  if (req.method === "OPTIONS" && url.pathname.startsWith("/tasks")) {
    return new Response(null, {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
      },
    });
  }

  if (!url.pathname.startsWith("/tasks")) return null;

  const parts = url.pathname.split("/").filter(Boolean); // ["tasks"] or ["tasks", id] or ["tasks", id, action]
  const taskId = parts[1];
  const action = parts[2]; // "claim" or "done"

  // DELETE blocked at HTTP level
  if (req.method === "DELETE") {
    return new Response(JSON.stringify({ error: "DELETE not allowed via HTTP" }), { status: 405, headers: corsHeaders });
  }

  // GET /tasks — list (excludes done and backlog by default)
  if (req.method === "GET" && !taskId) {
    const status = url.searchParams.get("status");
    const assignee = url.searchParams.get("assignee");
    const titleFilter = url.searchParams.get("title");
    let filtered = tasks;
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
    return new Response(JSON.stringify(task), { headers: corsHeaders });
  }

  // POST /tasks — create
  if (req.method === "POST" && !taskId) {
    let body: Record<string, unknown>;
    try {
      body = (await req.json()) as Record<string, unknown>;
    } catch {
      return new Response(JSON.stringify({ error: "invalid JSON" }), { status: 400, headers: corsHeaders });
    }
    if (!body.title || !body.createdBy) {
      return new Response(JSON.stringify({ error: "title and createdBy required" }), { status: 400, headers: corsHeaders });
    }
    if (body.priority !== undefined && !isValidPriority(body.priority)) {
      return new Response(JSON.stringify({ error: "invalid priority, must be P0-P3" }), { status: 400, headers: corsHeaders });
    }
    const task: TaskItem = {
      id: generateTaskId(tasks.map((t) => t.id)),
      title: String(body.title).trim(),
      description: body.description ? String(body.description) : undefined,
      priority: body.priority as TaskItem["priority"],
      status: "open",
      assignee: body.assignee ? String(body.assignee) : undefined,
      createdBy: String(body.createdBy),
      createdAt: Date.now(),
    };
    tasks.push(task);
    saveTasks(tasks);
    broadcast({ type: "tasks", tasks } as ServerMessage);
    return new Response(JSON.stringify(task), { status: 201, headers: corsHeaders });
  }

  // PATCH /tasks/:id — update
  if (req.method === "PATCH" && taskId && !action) {
    const task = tasks.find((t) => t.id === taskId);
    if (!task) return new Response(JSON.stringify({ error: "not found" }), { status: 404, headers: corsHeaders });
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
    saveTasks(tasks);
    broadcast({ type: "tasks", tasks } as ServerMessage);
    return new Response(JSON.stringify(task), { headers: corsHeaders });
  }

  // POST /tasks/:id/claim
  if (req.method === "POST" && taskId && action === "claim") {
    const task = tasks.find((t) => t.id === taskId);
    if (!task) return new Response(JSON.stringify({ error: "not found" }), { status: 404, headers: corsHeaders });
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
    const task = tasks.find((t) => t.id === taskId);
    if (!task) return new Response(JSON.stringify({ error: "not found" }), { status: 404, headers: corsHeaders });
    // Agents send `curl -d '{}'` — consume the body so Bun doesn't warn
    try {
      await req.json();
    } catch {}
    task.status = "done";
    saveTasks(tasks);
    broadcast({ type: "tasks", tasks } as ServerMessage);
    return new Response(JSON.stringify(task), { headers: corsHeaders });
  }

  return new Response(JSON.stringify({ error: "not found" }), { status: 404, headers: corsHeaders });
}
