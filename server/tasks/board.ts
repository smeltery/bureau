// Add or remove a task on the shared board from server code (not an HTTP
// request), with the same history record and broadcast the task API uses.
import { generateTaskId, type ServerMessage, type TaskItem } from "../../shared/types.ts";
import { broadcast, tasks } from "../ws/broadcast.ts";
import { taskStore } from "./store.ts";

export function addBoardTask(fields: Pick<TaskItem, "title" | "description" | "roomId" | "createdBy">): TaskItem {
  const task: TaskItem = { ...fields, id: generateTaskId([...tasks.map((t) => t.id), ...taskStore.ids()]), status: "open", createdAt: Date.now() };
  taskStore.commit(null, task, fields.createdBy);
  tasks.push(task);
  broadcast({ type: "tasks", tasks } as ServerMessage);
  return task;
}

export function removeBoardTask(taskId: string, actor: string): void {
  const index = tasks.findIndex((t) => t.id === taskId);
  if (index === -1) return;
  taskStore.commit(tasks[index]!, null, actor);
  tasks.splice(index, 1);
  broadcast({ type: "tasks", tasks } as ServerMessage);
}
