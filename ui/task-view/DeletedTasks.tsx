import { useState } from "react";
import { useAppState } from "../store.tsx";
import type { TaskItem } from "../../shared/tasks.ts";

export function DeletedTasks() {
  const { sessionContext } = useAppState();
  const [tasks, setTasks] = useState<TaskItem[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  async function load(after?: string) {
    try {
      const response = await fetch(`/api/tasks/deleted${after ? `?cursor=${after}` : ""}`);
      const data = await response.json();
      if (!response.ok) throw new Error(data.error);
      setTasks((previous) => (after ? [...previous, ...data.tasks] : data.tasks));
      setCursor(data.nextCursor);
      setError(null);
    } catch (err) {
      setError(String(err));
    }
  }
  async function restore(id: string) {
    try {
      const response = await fetch(`/api/tasks/${encodeURIComponent(id)}/restore`, { method: "POST" });
      if (!response.ok) throw new Error((await response.json()).error);
      await load();
    } catch (err) {
      setError(String(err));
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
      <summary>Deleted tasks</summary>
      {error && <p role="alert">{error}</p>}
      {tasks.map((task) => (
        <div key={task.id} style={{ display: "flex", gap: 12, padding: 4 }}>
          <span>{task.title}</span>
          <button onClick={() => void restore(task.id)}>Restore</button>
        </div>
      ))}
      {!tasks.length && <p>No deleted tasks.</p>}
      {cursor && <button onClick={() => void load(cursor)}>More</button>}
    </details>
  );
}
