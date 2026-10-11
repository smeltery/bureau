import { expect, test } from "bun:test";
import type { ServerWebSocket } from "bun";
import { bindWsUser } from "../user-sockets.ts";
import { claimUserByName, deleteUserById, clearWsUser } from "../users.ts";
import { handleTaskCommand } from "../ws/task-commands.ts";
import { tasks, setTasks } from "../ws/broadcast.ts";
import { taskStore } from "./store.ts";

test("socket task changes use the session actor and reject inaccessible rooms", () => {
  const user = claimUserByName(`Task member ${crypto.randomUUID()}`, { role: "member", allowedRooms: [] });
  const ws = { send: () => 0 } as unknown as ServerWebSocket<unknown>;
  bindWsUser(ws, user);
  const previous = [...tasks];
  try {
    setTasks([]);
    handleTaskCommand({ type: "add_task", title: "Global", username: "forged" }, ws);
    const task = tasks[0]!;
    expect(task.createdBy).toBe(user.name);
    handleTaskCommand({ type: "update_task", id: task.id, changes: { roomId: "private", title: "not allowed" } }, ws);
    expect(tasks[0]?.title).toBe("Global");
    expect(taskStore.read(task.id)?.history).toHaveLength(1);
    setTasks([{ ...task, roomId: "private" }]);
    handleTaskCommand({ type: "delete_task", id: task.id }, ws);
    expect(tasks).toHaveLength(1);
  } finally {
    setTasks(previous);
    clearWsUser(ws);
    deleteUserById(user.id);
  }
});
