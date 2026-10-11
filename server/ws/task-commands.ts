import type { ClientCommand, ServerMessage, TaskItem } from "../../shared/types.ts";
import { generateTaskId, isValidPriority, isValidStatus } from "../../shared/types.ts";
import { taskStore } from "../tasks/store.ts";
import type { ServerWebSocket } from "bun";
import { getWsUser, canSeeRoom } from "../users.ts";
import { broadcast, setTasks, tasks } from "./broadcast.ts";

export function handleTaskCommand(cmd: ClientCommand, ws?: ServerWebSocket<unknown>): boolean {
  const user = ws ? getWsUser(ws) : null;
  const allowed = (roomId?: string) => !ws || (!!user && (!roomId || canSeeRoom(user, roomId)));
  const actor = user ? `${user.name} (${user.id})` : "local";
  switch (cmd.type) {
    case "add_task": {
      if (!allowed(cmd.roomId)) return true;
      const task: TaskItem = {
        id: generateTaskId([...tasks.map((t) => t.id), ...taskStore.ids()]),
        title: cmd.title.trim(),
        description: cmd.description,
        priority: cmd.priority && isValidPriority(cmd.priority) ? cmd.priority : undefined,
        status: "open",
        assignee: cmd.assignee,
        roomId: cmd.roomId,
        createdBy: user?.name ?? cmd.username,
        createdAt: Date.now(),
      };
      taskStore.commit(null, task, actor);
      tasks.push(task);
      broadcast({ type: "tasks", tasks } as ServerMessage);
      return true;
    }
    case "update_task": {
      const before = tasks.find((t) => t.id === cmd.id);
      if (!before || !allowed(before.roomId) || !allowed(cmd.changes.roomId ?? before.roomId)) return true;
      const task = { ...before };
      if (task) {
        const c = cmd.changes;
        if (c.title !== undefined) task.title = String(c.title);
        if (c.description !== undefined) task.description = c.description ? String(c.description) : undefined;
        if (c.assignee !== undefined) task.assignee = c.assignee ? String(c.assignee) : undefined;
        if (c.roomId !== undefined) task.roomId = c.roomId ? String(c.roomId) : undefined;
        if (c.status !== undefined && isValidStatus(c.status)) task.status = c.status;
        if (c.priority !== undefined) {
          if (c.priority === null) {
            delete task.priority;
          } else if (isValidPriority(c.priority)) {
            task.priority = c.priority;
          }
        }
        taskStore.commit(before, task, actor);
        tasks[tasks.findIndex((t) => t.id === cmd.id)] = task;
        broadcast({ type: "tasks", tasks } as ServerMessage);
      }
      return true;
    }
    case "delete_task": {
      const before = tasks.find((t) => t.id === cmd.id);
      if (!before || !allowed(before.roomId)) return true;
      taskStore.commit(before, null, actor);
      const next = tasks.filter((t) => t.id !== cmd.id);
      setTasks(next);
      broadcast({ type: "tasks", tasks: next } as ServerMessage);
      return true;
    }
    default:
      return false;
  }
}
