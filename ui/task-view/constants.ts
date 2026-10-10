import type { TaskPriority, TaskStatus } from "../../shared/types.ts";

export type SortField = "status" | "priority" | "title" | "room" | "assignee" | "createdBy" | "createdAt";
export type SortDir = "asc" | "desc";

export const STATUS_ORDER: Record<TaskStatus, number> = { in_progress: 0, open: 1, backlog: 2, done: 3, obsolete: 4 };
export const PRIORITY_ORDER: Record<string, number> = { P0: 0, P1: 1, P2: 2, P3: 3 };

export const STATUS_COLORS: Record<TaskStatus, string> = {
  open: "var(--blue, #58a6ff)",
  in_progress: "var(--green)",
  backlog: "var(--purple)",
  done: "var(--text-muted)",
  obsolete: "var(--text-muted)",
};

export const STATUS_LABELS: Record<TaskStatus, string> = {
  open: "Open",
  in_progress: "In Progress",
  backlog: "Backlog",
  done: "Done",
  obsolete: "Obsolete",
};

export const PRIORITY_COLORS: Record<TaskPriority, string> = {
  P0: "var(--red)",
  P1: "var(--orange, #d29922)",
  P2: "var(--blue, #58a6ff)",
  P3: "var(--text-muted)",
};

export const STATUS_LABEL_KEYS = {
  open: "tasks.status.open",
  in_progress: "tasks.status.inProgress",
  backlog: "tasks.status.backlog",
  done: "tasks.status.done",
  obsolete: "tasks.status.obsolete",
} as const;
