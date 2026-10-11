import { expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createTaskStore } from "./store.ts";
import type { TaskItem } from "../../shared/tasks.ts";

test("task records preserve legacy state, history, deletion and recovery across reloads", () => {
  const root = mkdtempSync(join(tmpdir(), "bureau-task-history-"));
  const legacy = join(root, "tasks.json");
  const directory = join(root, "records");
  const task: TaskItem = { id: "old", title: "Old task", status: "open", createdBy: "Owner", createdAt: 1 };
  const sibling = { ...task, id: "sibling" };
  writeFileSync(legacy, JSON.stringify([task, sibling]));
  try {
    const store = createTaskStore(directory, legacy);
    const updated = { ...task, status: "done" as const };
    store.commit(task, updated, "Ada");
    expect(store.load()).toEqual([updated, sibling]);
    expect(JSON.parse(readFileSync(legacy, "utf8"))).toEqual([task, sibling]);
    expect(store.read(task.id)?.history[0]).toMatchObject({ actor: "Ada", operation: "update", fields: ["status"], before: task, after: updated });
    expect(() => store.commit(task, { ...task, title: "stale" }, "Other")).toThrow("Task changed");
    store.commit(updated, null, "Ada");
    const reopened = createTaskStore(directory, legacy);
    expect(reopened.load()).toEqual([sibling]);
    expect(reopened.deleted()).toEqual([updated]);
    reopened.commit(null, updated, "Owner");
    reopened.commit(updated, updated, "Owner");
    expect(reopened.read(task.id)?.history.map((entry) => entry.operation)).toEqual(["update", "delete", "restore"]);
    expect(reopened.deleted()).toEqual([]);
    expect(() => reopened.read("../outside")).toThrow("invalid task id");
    writeFileSync(join(directory, "old.json"), "broken");
    expect(() => reopened.load()).toThrow();
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
