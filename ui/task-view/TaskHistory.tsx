import { useEffect, useState } from "react";
import type { TaskHistoryPage } from "../../shared/tasks.ts";

export function TaskHistory({ taskId, revision }: { taskId: string; revision: string }) {
  const [page, setPage] = useState<TaskHistoryPage | null>(null);
  const [error, setError] = useState<string | null>(null);
  async function load(cursor?: string) {
    try {
      const response = await fetch(`/api/tasks/${encodeURIComponent(taskId)}/history${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ""}`);
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Unable to read task history");
      setPage((previous) => ({ entries: cursor ? [...(previous?.entries ?? []), ...data.entries] : data.entries, nextCursor: data.nextCursor }));
      setError(null);
    } catch (err) {
      setError(String(err));
    }
  }
  useEffect(() => {
    void load();
  }, [taskId, revision]);
  return (
    <details style={{ padding: "12px 24px", overflowWrap: "anywhere", maxHeight: 240, overflowY: "auto", flexShrink: 0 }}>
      <summary>History</summary>
      {error && <p role="alert">{error}</p>}
      {page?.entries.map((entry) => (
        <div key={entry.id} style={{ marginTop: 8, fontSize: 12 }}>
          <span title={new Date(entry.at).toLocaleString()} style={{ color: "var(--accent)" }}>
            {entry.actor}
          </span>{" "}
          {entry.operation}
          {entry.fields
            .filter((field) => !["id", "createdAt", "createdBy"].includes(field))
            .map((field) => (
              <div key={field}>
                {field}: {String((entry.before as unknown as Record<string, unknown> | null)?.[field] ?? "—")} → {String((entry.after as unknown as Record<string, unknown> | null)?.[field] ?? "—")}
              </div>
            ))}
        </div>
      ))}
      {page && !page.entries.length && <p>No recorded changes yet.</p>}
      {page?.nextCursor && <button onClick={() => void load(page.nextCursor!)}>Older changes</button>}
    </details>
  );
}
