import { afterEach, describe, expect, test } from "bun:test";
import { handleTaskCommand } from "./task-commands.ts";
import { setTasks, tasks } from "./broadcast.ts";

describe("handleTaskCommand", () => {
  afterEach(() => {
    setTasks([]);
  });

  test("clears task priority when update_task sends null", () => {
    setTasks([
      {
        id: "task-1",
        title: "Clear me",
        priority: "P1",
        status: "open",
        createdBy: "Boss",
        createdAt: 1,
      },
    ]);

    const handled = handleTaskCommand({
      type: "update_task",
      id: "task-1",
      changes: { priority: null },
    });

    expect(handled).toBe(true);
    expect(tasks[0]?.priority).toBeUndefined();
    expect("priority" in tasks[0]!).toBe(false);
  });
});
