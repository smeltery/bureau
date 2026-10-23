import { useI18n } from "../i18n.tsx";
import { taskResponse, taskFailure, type TaskFailure } from "./request.ts";
import { useState } from "react";
import { useAppState } from "../store.tsx";
import type { TaskItem } from "../../shared/tasks.ts";

export function DeletedTasks() {
  const { t } = useI18n();
  const { sessionContext } = useAppState();
  const [tasks, setTasks] = useState<TaskItem[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [error, setError] = useState<TaskFailure | null>(null);
  async function load(after?: string) {
    try {
      const response = await taskResponse(`/api/tasks/deleted${after ? `?cursor=${encodeURIComponent(after)}` : ""}`, "tasks.deleted.failed");
      const data = await response.json();
      setTasks((previous) => (after ? [...previous, ...data.tasks] : data.tasks));
      setCursor(data.nextCursor);
      setError(null);
    } catch (err) {
      setError(taskFailure(err, "tasks.deleted.failed"));
    }
  }
  async function restore(id: string) {
    try {
      await taskResponse(`/api/tasks/${encodeURIComponent(id)}/restore`, "tasks.deleted.restoreFailed", { method: "POST" });
      await load();
    } catch (err) {
      setError(taskFailure(err, "tasks.deleted.restoreFailed"));
    }
  }
  if (sessionContext?.role !== "owner") return null;
  return (
    <details
      style={{ padding: "8px 20px", maxHeight: 200, overflowY: "auto" }}
      onToggle={(event) => {
        if (event.currentTarget.open) void load();
      }}
    >
      <summary>{t("tasks.deleted.title")}</summary>
      {error && <p role="alert">{typeof error === "string" ? error : t(error.key)}</p>}
      {tasks.map((task) => (
        <div key={task.id} style={{ display: "flex", gap: 12, padding: 4 }}>
          <span>{task.title}</span>
          <button onClick={() => void restore(task.id)}>{t("tasks.deleted.restore")}</button>
        </div>
      ))}
      {!tasks.length && <p>{t("tasks.deleted.empty")}</p>}
      {cursor && <button onClick={() => void load(cursor)}>{t("tasks.deleted.more")}</button>}
    </details>
  );
}
