import { useEffect, useState } from "react";
import type { TaskHistoryPage } from "../../shared/tasks.ts";
import { useI18n } from "../i18n.tsx";
import { taskResponse, taskFailure, type TaskFailure } from "./request.ts";
import { isValidStatus } from "../../shared/tasks.ts";
import { keyFrom, type PlainMessageKey } from "../../shared/i18n/translate.ts";
import { STATUS_LABEL_KEYS } from "./constants.ts";

const FIELD_LABELS: Record<string, PlainMessageKey> = {
  title: "tasks.field.title",
  description: "tasks.field.description",
  priority: "tasks.priority",
  status: "tasks.field.status",
  assignee: "tasks.field.assignee",
  roomId: "common.room",
};
const OPERATION_LABELS = { create: "tasks.history.create", update: "tasks.history.update", delete: "tasks.history.delete", restore: "tasks.history.restore" } as const;

export function TaskHistory({ taskId, revision }: { taskId: string; revision: string }) {
  const { t, language } = useI18n();
  const [page, setPage] = useState<TaskHistoryPage | null>(null);
  const [error, setError] = useState<TaskFailure | null>(null);
  async function load(cursor?: string) {
    try {
      const response = await taskResponse(`/api/tasks/${encodeURIComponent(taskId)}/history${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ""}`, "tasks.history.failed");
      const data = await response.json();
      setPage((previous) => ({ entries: cursor ? [...(previous?.entries ?? []), ...data.entries] : data.entries, nextCursor: data.nextCursor }));
      setError(null);
    } catch (err) {
      setError(taskFailure(err, "tasks.history.failed"));
    }
  }
  useEffect(() => {
    void load();
  }, [taskId, revision]);
  function fieldLabel(field: string): string {
    const key = keyFrom(FIELD_LABELS, field);
    return key ? t(key) : field;
  }
  function fieldValue(value: unknown, field: string): string {
    return field === "status" && isValidStatus(value) ? t(STATUS_LABEL_KEYS[value]) : String(value ?? "—");
  }
  return (
    <details style={{ padding: "12px 24px", overflowWrap: "anywhere", maxHeight: 240, overflowY: "auto", flexShrink: 0 }}>
      <summary>{t("tasks.history.title")}</summary>
      {error && <p role="alert">{typeof error === "string" ? error : t(error.key)}</p>}
      {page?.entries.map((entry) => (
        <div key={entry.id} style={{ marginTop: 8, fontSize: 12 }}>
          <span title={new Date(entry.at).toLocaleString(language)} style={{ color: "var(--accent)" }}>
            {entry.actor}
          </span>{" "}
          {t(OPERATION_LABELS[entry.operation])}
          {entry.fields
            .filter((field) => !["id", "createdAt", "createdBy"].includes(field))
            .map((field) => (
              <div key={field}>
                {fieldLabel(field)}: {fieldValue((entry.before as unknown as Record<string, unknown> | null)?.[field], field)} →{" "}
                {fieldValue((entry.after as unknown as Record<string, unknown> | null)?.[field], field)}
              </div>
            ))}
        </div>
      ))}
      {page && !page.entries.length && <p>{t("tasks.history.empty")}</p>}
      {page?.nextCursor && <button onClick={() => void load(page.nextCursor!)}>{t("tasks.history.older")}</button>}
    </details>
  );
}
