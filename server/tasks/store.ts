import { existsSync, mkdirSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type { TaskItem } from "../../shared/tasks.ts";
import type { TaskChange } from "../../shared/tasks.ts";
import { atomicWriteFileSync, BUREAU_DIR, TASKS_FILE } from "../persistence/paths.ts";

interface RecordFile {
  task: TaskItem | null;
  history: TaskChange[];
}
const same = (a: TaskItem | null, b: TaskItem | null) =>
  JSON.stringify(
    a &&
      Object.entries(a)
        .filter(([, value]) => value !== undefined)
        .sort(),
  ) ===
  JSON.stringify(
    b &&
      Object.entries(b)
        .filter(([, value]) => value !== undefined)
        .sort(),
  );

export class TaskStoreError extends Error {
  constructor(
    message: string,
    public status = 500,
  ) {
    super(message);
  }
}

export function createTaskStore(directory = join(BUREAU_DIR, "task-records"), legacyFile = TASKS_FILE) {
  function path(id: string) {
    if (!/^[a-zA-Z0-9_-]{1,100}$/.test(id)) throw new TaskStoreError("invalid task id", 400);
    return join(directory, `${id}.json`);
  }
  function read(id: string): RecordFile | null {
    const file = path(id);
    if (!existsSync(file)) return null;
    const record = JSON.parse(readFileSync(file, "utf8")) as RecordFile;
    if (!record || !Array.isArray(record.history) || (record.task !== null && record.task?.id !== id)) throw new TaskStoreError(`Invalid task record: ${id}`);
    return record;
  }
  function ids(): string[] {
    return existsSync(directory)
      ? readdirSync(directory)
          .filter((name) => /^[a-zA-Z0-9_-]{1,100}\.json$/.test(name))
          .map((name) => name.slice(0, -5))
      : [];
  }
  function load(): TaskItem[] {
    const legacy = existsSync(legacyFile) ? JSON.parse(readFileSync(legacyFile, "utf8")) : [];
    if (!Array.isArray(legacy)) throw new TaskStoreError("Invalid legacy task board");
    const tasks = new Map<string, TaskItem>(legacy.map((task: TaskItem) => [task.id, task]));
    for (const id of ids()) {
      const record = read(id)!;
      if (record.task) tasks.set(id, record.task);
      else tasks.delete(id);
    }
    return [...tasks.values()];
  }
  function commit(before: TaskItem | null, after: TaskItem | null, actor: string): void {
    const id = after?.id ?? before?.id;
    if (!id || (before && after && before.id !== after.id)) throw new TaskStoreError("Task identity cannot change", 400);
    if (same(before, after)) return;
    const previous = read(id);
    if (previous && !same(previous.task, before)) throw new TaskStoreError("Task changed; refresh before retrying", 409);
    const fields = [...new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})])].filter((key) => (before as any)?.[key] !== (after as any)?.[key]);
    const event: TaskChange = {
      id: crypto.randomUUID(),
      at: Date.now(),
      actor,
      operation: after === null ? "delete" : before === null ? (previous ? "restore" : "create") : "update",
      before,
      after,
      fields,
    };
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    // One rename commits the state and its history together; the legacy board is untouched.
    atomicWriteFileSync(path(id), JSON.stringify({ task: after, history: [...(previous?.history ?? []), event] } satisfies RecordFile));
  }
  function deleted(): TaskItem[] {
    return ids().flatMap((id) => {
      const record = read(id)!;
      const before = record.history.at(-1)?.before;
      return record.task === null && before ? [before] : [];
    });
  }
  return { load, commit, read, deleted, ids };
}

export const taskStore = createTaskStore();
