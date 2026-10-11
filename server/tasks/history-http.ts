import type { TaskItem } from "../../shared/tasks.ts";
import { taskStore } from "./store.ts";
import { broadcast, tasks } from "../ws/broadcast.ts";

export function taskHistoryResponse(
  req: Request,
  url: URL,
  id: string | undefined,
  action: string | undefined,
  owner: boolean,
  actor: string | null,
  canRead: (task: TaskItem) => boolean,
): Response | null {
  if (id === "deleted" && !action && req.method === "GET") {
    if (!owner) return Response.json({ error: "owner access required" }, { status: 403 });
    const offset = readCursor(url);
    if (offset === null) return Response.json({ error: "invalid cursor" }, { status: 400 });
    const deleted = taskStore.deleted().sort((a, b) => a.id.localeCompare(b.id));
    return Response.json({ tasks: deleted.slice(offset, offset + 50), nextCursor: offset + 50 < deleted.length ? String(offset + 50) : null });
  }
  if (!id || (action !== "history" && action !== "restore")) return null;
  const live = tasks.find((task) => task.id === id);
  if (action === "history" && req.method === "GET") {
    if (!live || !canRead(live)) return Response.json({ error: "not found" }, { status: 404 });
    const offset = readCursor(url);
    if (offset === null) return Response.json({ error: "invalid cursor" }, { status: 400 });
    const entries = (taskStore.read(id)?.history ?? []).filter((entry) => (!entry.before || canRead(entry.before)) && (!entry.after || canRead(entry.after))).reverse();
    return Response.json({ entries: entries.slice(offset, offset + 50), nextCursor: offset + 50 < entries.length ? String(offset + 50) : null });
  }
  if (action === "restore" && req.method === "POST") {
    if (!owner || !actor) return Response.json({ error: "owner access required" }, { status: 403 });
    if (live) return Response.json({ error: "task already exists" }, { status: 409 });
    const record = taskStore.read(id);
    const previous = record?.history.at(-1)?.before;
    if (!record || record.task || !previous) return Response.json({ error: "deleted task not found" }, { status: 404 });
    if (!canRead(previous)) return Response.json({ error: "task room no longer exists" }, { status: 409 });
    taskStore.commit(null, previous, actor);
    tasks.push(previous);
    broadcast({ type: "tasks", tasks });
    return Response.json(previous);
  }
  return Response.json({ error: "method not allowed" }, { status: 405 });
}

function readCursor(url: URL): number | null {
  const value = url.searchParams.get("cursor") ?? "0";
  return /^\d+$/.test(value) && Number.isSafeInteger(Number(value)) ? Number(value) : null;
}
