import { describe, expect, test } from "bun:test";
import type { TaskItem } from "../../shared/types.ts";
import { filterAndSortTasks, taskFilterCounts } from "./taskFilters.ts";

const tasks: TaskItem[] = [
  { id: "task-1", title: "Fix auth", status: "done", createdBy: "Alice", createdAt: 10, priority: "P2", assignee: "Claude" },
  { id: "task-2", title: "Build panel", description: "Settings area", status: "open", createdBy: "Bob", createdAt: 30, priority: "P1", assignee: "Codex" },
  { id: "task-3", title: "Refactor routes", status: "in_progress", createdBy: "Alice", createdAt: 20, priority: "P0" },
  { id: "task-4", title: "Write docs", status: "backlog", createdBy: "Dana", createdAt: 40 },
];

describe("filterAndSortTasks", () => {
  test("active status hides done and backlog tasks", () => {
    expect(filterAndSortTasks(tasks, "all", "active", "", "", "createdAt", "asc").map((task) => task.id)).toEqual(["task-3", "task-2"]);
  });

  test("search matches id, title, and description", () => {
    expect(filterAndSortTasks(tasks, "all", "all", "settings", "", "createdAt", "asc").map((task) => task.id)).toEqual(["task-2"]);
    expect(filterAndSortTasks(tasks, "all", "all", "routes", "", "createdAt", "asc").map((task) => task.id)).toEqual(["task-3"]);
    expect(filterAndSortTasks(tasks, "all", "all", "task-1", "", "createdAt", "asc").map((task) => task.id)).toEqual(["task-1"]);
  });

  test("assignee filter is case-insensitive", () => {
    expect(filterAndSortTasks(tasks, "all", "all", "", "code", "createdAt", "asc").map((task) => task.id)).toEqual(["task-2"]);
  });

  test("sorts by priority order with unprioritized tasks last", () => {
    expect(filterAndSortTasks(tasks, "all", "all", "", "", "priority", "asc").map((task) => task.id)).toEqual(["task-3", "task-2", "task-1", "task-4"]);
  });

  test("sorts office-wide tasks before room-scoped tasks", () => {
    const roomTasks: TaskItem[] = [
      { ...tasks[0], id: "office", roomId: undefined },
      { ...tasks[1], id: "room-b", roomId: "room-b" },
      { ...tasks[2], id: "room-a", roomId: "room-a" },
    ];
    expect(filterAndSortTasks(roomTasks, "all", "all", "", "", "room", "asc").map((task) => task.id)).toEqual(["office", "room-a", "room-b"]);
  });

  test("filters by room scope", () => {
    const roomTasks: TaskItem[] = [
      { ...tasks[0], id: "office", roomId: undefined },
      { ...tasks[1], id: "room-a-task", roomId: "room-a" },
      { ...tasks[2], id: "room-b-task", roomId: "room-b" },
    ];
    expect(filterAndSortTasks(roomTasks, "global", "all", "", "", "createdAt", "asc").map((task) => task.id)).toEqual(["office"]);
    expect(filterAndSortTasks(roomTasks, "room-a", "all", "", "", "createdAt", "asc").map((task) => task.id)).toEqual(["room-a-task"]);
  });
});

test("combined filters include unprioritized tasks and an empty selection shows nothing", () => {
  const closed: TaskItem = { id: "old", title: "Dropped", status: "obsolete", createdAt: 50, createdBy: "Boss" };
  expect(filterAndSortTasks([...tasks, closed], "all", "active", "", "", "createdAt", "asc")).not.toContainEqual(closed);
  expect(filterAndSortTasks([...tasks, closed], "all", ["obsolete", "backlog"], "", "", "createdAt", "asc", ["none"]).map((t) => t.id)).toEqual(["task-4", "old"]);
  expect(filterAndSortTasks(tasks, "all", [], "", "", "createdAt", "asc")).toEqual([]);
  expect(filterAndSortTasks(tasks, "all", "all", "", "", "createdAt", "asc", [])).toEqual([]);
});

test("counts apply the opposite group and contextual filters without changing their own totals", () => {
  expect(taskFilterCounts(tasks, "all", ["open"], ["P0", "P1"], "", "")).toEqual({ statusCounts: { open: 1, in_progress: 1 }, priorityCounts: { P1: 1 } });
  expect(taskFilterCounts(tasks, "all", ["done"], ["P0", "P1"], "", "")).toEqual({ statusCounts: { open: 1, in_progress: 1 }, priorityCounts: { P2: 1 } });
  expect(taskFilterCounts(tasks, "all", ["open"], ["P1"], "Settings", "codex")).toEqual({ statusCounts: { open: 1 }, priorityCounts: { P1: 1 } });
  expect(taskFilterCounts(tasks, "missing-room", ["open"], ["P1"], "", "")).toEqual({ statusCounts: {}, priorityCounts: {} });
});
