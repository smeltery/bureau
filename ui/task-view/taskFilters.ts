import type { TaskItem, TaskStatus } from "../../shared/types.ts";
import { PRIORITY_ORDER, STATUS_ORDER, type SortDir, type SortField } from "./constants.ts";

export type TaskStatusFilter = TaskStatus | "all" | "active";

export function filterAndSortTasks(tasks: TaskItem[], filterStatus: TaskStatusFilter, search: string, filterAssignee: string, sortField: SortField, sortDir: SortDir): TaskItem[] {
  let list = tasks;
  if (filterStatus === "active") {
    list = list.filter((task) => task.status !== "done" && task.status !== "backlog");
  } else if (filterStatus !== "all") {
    list = list.filter((task) => task.status === filterStatus);
  }

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
