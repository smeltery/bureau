import type { ClientCommand, ServerMessage, TaskItem } from "../../shared/types.ts";
import { generateTaskId, isValidPriority, isValidStatus } from "../../shared/types.ts";
import { saveTasks } from "../persistence.ts";
import { broadcast, setTasks, tasks } from "./broadcast.ts";

export function handleTaskCommand(cmd: ClientCommand): boolean {
  switch (cmd.type) {
    case "add_task": {
      const task: TaskItem = {
        id: generateTaskId(tasks.map((t) => t.id)),
        title: cmd.title.trim(),
        description: cmd.description,
        priority: cmd.priority && isValidPriority(cmd.priority) ? cmd.priority : undefined,
        status: "open",
        assignee: cmd.assignee,
        createdBy: cmd.username,
        createdAt: Date.now(),
      };
      tasks.push(task);
      saveTasks(tasks);
      broadcast({ type: "tasks", tasks } as ServerMessage);
      return true;
    }
    case "update_task": {
      const task = tasks.find((t) => t.id === cmd.id);
      if (task) {
        const c = cmd.changes;
        if (c.title !== undefined) task.title = String(c.title);
        if (c.description !== undefined) task.description = c.description ? String(c.description) : undefined;
        if (c.assignee !== undefined) task.assignee = c.assignee ? String(c.assignee) : undefined;
        if (c.status !== undefined && isValidStatus(c.status)) task.status = c.status;
        if (c.priority !== undefined && isValidPriority(c.priority)) task.priority = c.priority;
        saveTasks(tasks);
        broadcast({ type: "tasks", tasks } as ServerMessage);
      }
      return true;
    }
    case "delete_task": {
      const next = tasks.filter((t) => t.id !== cmd.id);
      setTasks(next);
      saveTasks(next);
      broadcast({ type: "tasks", tasks: next } as ServerMessage);
      return true;
    }
    default:
      return false;
  }
}
