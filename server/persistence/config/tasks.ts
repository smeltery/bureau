import { readFileSync, existsSync } from "fs";
import type { TaskItem } from "../../../shared/types.ts";
import { atomicWriteFileSync, TASKS_FILE } from "../paths.ts";

export function loadTasks(): TaskItem[] {
  try {
    if (!existsSync(TASKS_FILE)) return [];
    return JSON.parse(readFileSync(TASKS_FILE, "utf-8")) as TaskItem[];
  } catch {
    return [];
  }
}

export function saveTasks(tasks: TaskItem[]) {
  try {
    atomicWriteFileSync(TASKS_FILE, JSON.stringify(tasks, null, 2));
  } catch (err) {
    console.error("Failed to save tasks:", err);
  }
}
