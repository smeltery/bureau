import type { TaskItem, TaskStatus, TaskPriority } from "../../shared/types.ts";
import { PRIORITY_ORDER, STATUS_ORDER, type SortDir, type SortField } from "./constants.ts";

export type TaskStatusFilter = TaskStatus | "all" | "active" | readonly TaskStatus[];
export type TaskPriorityFilter = TaskPriority | "none";
export const TASK_PRIORITIES: TaskPriorityFilter[] = ["P0", "P1", "P2", "P3", "none"];
export type TaskRoomScope = "all" | "global" | string;

export function filterAndSortTasks(
  tasks: TaskItem[],
  roomScope: TaskRoomScope,
  filterStatus: TaskStatusFilter,
  search: string,
  filterAssignee: string,
  sortField: SortField,
  sortDir: SortDir,
  priorities: readonly TaskPriorityFilter[] = TASK_PRIORITIES,
): TaskItem[] {
  let list = tasks;
  if (roomScope === "global") {
    list = list.filter((task) => !task.roomId);
  } else if (roomScope !== "all") {
    list = list.filter((task) => task.roomId === roomScope);
  }

  if (Array.isArray(filterStatus)) {
    list = list.filter((task) => filterStatus.includes(task.status));
  } else if (filterStatus === "active") {
    list = list.filter((task) => task.status === "open" || task.status === "in_progress");
  } else if (filterStatus !== "all") {
    list = list.filter((task) => task.status === filterStatus);
  }

  list = list.filter((task) => priorities.includes(task.priority ?? "none"));

  if (search) {
    const query = search.toLowerCase();
    list = list.filter((task) => task.id.toLowerCase().includes(query) || task.title.toLowerCase().includes(query) || (task.description && task.description.toLowerCase().includes(query)));
  }

  if (filterAssignee) {
    const query = filterAssignee.toLowerCase();
    list = list.filter((task) => task.assignee?.toLowerCase().includes(query));
  }

  return [...list].sort((a, b) => {
    const cmp = compareTasks(a, b, sortField);
    return sortDir === "asc" ? cmp : -cmp;
  });
}

function compareTasks(a: TaskItem, b: TaskItem, sortField: SortField): number {
  switch (sortField) {
    case "status":
      return STATUS_ORDER[a.status] - STATUS_ORDER[b.status];
    case "priority": {
      const priorityA = a.priority ? PRIORITY_ORDER[a.priority] : 99;
      const priorityB = b.priority ? PRIORITY_ORDER[b.priority] : 99;
      return priorityA - priorityB;
    }
    case "title":
      return a.title.localeCompare(b.title);
    case "room":
      return (a.roomId || "").localeCompare(b.roomId || "");
    case "assignee":
      return (a.assignee || "").localeCompare(b.assignee || "");
    case "createdBy":
      return a.createdBy.localeCompare(b.createdBy);
    case "createdAt":
      return a.createdAt - b.createdAt;
  }
}

/** Each count applies the opposite checkbox group, plus room/search/assignee. */
export function taskFilterCounts(tasks: TaskItem[], room: TaskRoomScope, statuses: readonly TaskStatus[], priorities: readonly TaskPriorityFilter[], search: string, assignee: string) {
  const base = filterAndSortTasks(tasks, room, "all", search, assignee, "createdAt", "asc");
  const statusCounts: Partial<Record<TaskStatus, number>> = {};
  const priorityCounts: Partial<Record<TaskPriorityFilter, number>> = {};
  for (const task of base) {
    const priority = task.priority ?? "none";
    if (priorities.includes(priority)) statusCounts[task.status] = (statusCounts[task.status] ?? 0) + 1;
    if (statuses.includes(task.status)) priorityCounts[priority] = (priorityCounts[priority] ?? 0) + 1;
  }
  return { statusCounts, priorityCounts };
}
