import type { ServerWebSocket } from "bun";
import type { ServerMessage, TaskItem } from "../../shared/types.ts";
import { loadTasks } from "../persistence.ts";

// Connected browser WebSockets. Owned here so both the fetch() routes and the
// websocket handlers can broadcast + track membership.
export const browsers = new Set<ServerWebSocket<unknown>>();

export function broadcast(msg: ServerMessage) {
  const data = JSON.stringify(msg);
  for (const ws of browsers) {
    ws.send(data);
  }
}

// Shared task list. Mutated by /tasks HTTP routes (server/http/tasks.ts) and
// by WS commands (server/ws/commands.ts). A setter is exported because
// delete replaces the whole array with a filtered copy.
export let tasks: TaskItem[] = loadTasks();
export function setTasks(next: TaskItem[]) { tasks = next; }
