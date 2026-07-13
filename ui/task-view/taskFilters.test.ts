import { describe, expect, test } from "bun:test";
import type { TaskItem } from "../../shared/types.ts";
import { filterAndSortTasks } from "./taskFilters.ts";

const tasks: TaskItem[] = [
  { id: "task-1", title: "Fix auth", status: "done", createdBy: "Alice", createdAt: 10, priority: "P2", assignee: "Claude" },
  { id: "task-2", title: "Build panel", description: "Settings area", status: "open", createdBy: "Bob", createdAt: 30, priority: "P1", assignee: "Codex" },
  { id: "task-3", title: "Refactor routes", status: "in_progress", createdBy: "Alice", createdAt: 20, priority: "P0" },
  { id: "task-4", title: "Write docs", status: "backlog", createdBy: "Dana", createdAt: 40 },
];

describe("filterAndSortTasks", () => {
  test("active status hides done and backlog tasks", () => {
    expect(filterAndSortTasks(tasks, "active", "", "", "createdAt", "asc").map((task) => task.id)).toEqual(["task-3", "task-2"]);
  });

  test("search matches id, title, and description", () => {
    expect(filterAndSortTasks(tasks, "all", "settings", "", "createdAt", "asc").map((task) => task.id)).toEqual(["task-2"]);
    expect(filterAndSortTasks(tasks, "all", "routes", "", "createdAt", "asc").map((task) => task.id)).toEqual(["task-3"]);
    expect(filterAndSortTasks(tasks, "all", "task-1", "", "createdAt", "asc").map((task) => task.id)).toEqual(["task-1"]);
  });

  test("assignee filter is case-insensitive", () => {
    expect(filterAndSortTasks(tasks, "all", "", "code", "createdAt", "asc").map((task) => task.id)).toEqual(["task-2"]);
  });

  test("sorts by priority order with unprioritized tasks last", () => {
    expect(filterAndSortTasks(tasks, "all", "", "", "priority", "asc").map((task) => task.id)).toEqual(["task-3", "task-2", "task-1", "task-4"]);
  });
});
