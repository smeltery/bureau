import type { TaskStatus } from "../../shared/tasks.ts";
import { useI18n } from "../i18n.tsx";
import { TASK_PRIORITIES, type TaskPriorityFilter, type taskFilterCounts } from "./taskFilters.ts";
import { STATUS_LABEL_KEYS } from "./constants.ts";

export function TaskFilterOptions({
  statuses,
  onStatuses,
  priorities,
  onPriorities,
  counts,
}: {
  statuses: TaskStatus[];
  onStatuses: (value: TaskStatus[]) => void;
  priorities: TaskPriorityFilter[];
  onPriorities: (value: TaskPriorityFilter[]) => void;
  counts: ReturnType<typeof taskFilterCounts>;
}) {
  const { t } = useI18n();
  function group<T extends string>(label: string, options: T[], selected: T[], change: (value: T[]) => void, name: (value: T) => string, count: Partial<Record<T, number>>) {
    return (
      <details style={{ position: "relative" }}>
        <summary style={{ cursor: "pointer", padding: "8px", whiteSpace: "nowrap" }}>
          {label} ({selected.length})
        </summary>
        <fieldset
          style={{
            position: "absolute",
            right: 0,
            top: "100%",
            minWidth: 170,
            margin: 0,
            padding: 10,
            background: "var(--bg-base)",
            border: "1px solid var(--border)",
            borderRadius: 6,
            boxShadow: "0 4px 16px #0005",
          }}
        >
          <legend>{label}</legend>
          {options.map((value) => (
            <label key={value} style={{ display: "flex", alignItems: "center", gap: 8, padding: 5, whiteSpace: "nowrap" }}>
              <input type="checkbox" checked={selected.includes(value)} onChange={() => change(selected.includes(value) ? selected.filter((item) => item !== value) : [...selected, value])} />
              {name(value)} <span style={{ marginLeft: "auto", color: "var(--text-muted)" }}>{count[value] ?? 0}</span>
            </label>
          ))}
        </fieldset>
      </details>
    );
  }
  return (
    <>
      {group(t("common.status"), ["open", "in_progress", "backlog", "done", "obsolete"] as TaskStatus[], statuses, onStatuses, (value) => t(STATUS_LABEL_KEYS[value]), counts.statusCounts)}
      {group(t("tasks.priority"), TASK_PRIORITIES, priorities, onPriorities, (value) => (value === "none" ? t("tasks.noPriority") : value), counts.priorityCounts)}
    </>
  );
}
