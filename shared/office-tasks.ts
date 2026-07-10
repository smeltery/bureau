import type { TaskItem, TaskPriority, TaskStatus } from "./types.ts";
import { generateTaskId } from "./types.ts";
import type { OfficeEvent } from "./office-state.ts";

export function addTaskToList(
  tasks: TaskItem[],
  title: string,
  createdBy: string,
  opts?: { description?: string; priority?: TaskPriority; assignee?: string },
): { tasks: TaskItem[]; events: OfficeEvent[] } {
  const nextTasks = [...tasks];
  const task: TaskItem = {
    id: generateTaskId(nextTasks.map((t) => t.id)),
    title: title.trim(),
    description: opts?.description,
    priority: opts?.priority,
    status: "open",
    assignee: opts?.assignee,
    createdBy,
    createdAt: Date.now(),
  };
  nextTasks.push(task);
  return { tasks: nextTasks, events: [{ type: "tasks_changed", tasks: [...nextTasks] }] };
}

export function updateTaskInList(
  tasks: TaskItem[],
  id: string,
  changes: Partial<Pick<TaskItem, "title" | "description" | "priority" | "status" | "assignee">>,
): { tasks: TaskItem[]; events: OfficeEvent[] } {
  const nextTasks = tasks.map((task) => (task.id === id ? { ...task, ...changes } : task));
  if (nextTasks === tasks || !tasks.some((task) => task.id === id)) return { tasks, events: [] };
  return { tasks: nextTasks, events: [{ type: "tasks_changed", tasks: [...nextTasks] }] };
}

export function deleteTaskFromList(tasks: TaskItem[], id: string): { tasks: TaskItem[]; events: OfficeEvent[] } {
  const nextTasks = tasks.filter((task) => task.id !== id);
  return { tasks: nextTasks, events: [{ type: "tasks_changed", tasks: [...nextTasks] }] };
}
