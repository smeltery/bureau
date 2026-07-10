import type { CSSProperties, ReactNode } from "react";
import type { TaskItem } from "../../shared/types.ts";
import { timeAgo } from "../utils/time.ts";
import { PRIORITY_COLORS, STATUS_COLORS, STATUS_LABELS, type SortDir, type SortField } from "./constants.ts";

export function TaskTable({
  tasks,
  tasksLoaded,
  selectedId,
  isMobile,
  cellPad,
  thStyle,
  sortField,
  sortDir,
  onSort,
  onSelect,
  renderName,
}: {
  tasks: TaskItem[];
  tasksLoaded: boolean;
  selectedId: string | null;
  isMobile: boolean;
  cellPad: string;
  thStyle: CSSProperties;
  sortField: SortField;
  sortDir: SortDir;
  onSort: (field: SortField) => void;
  onSelect: (task: TaskItem) => void;
  renderName: (name: string | undefined) => ReactNode;
}) {
  return (
    <table style={{ width: "100%", borderCollapse: "collapse", tableLayout: isMobile ? "fixed" : undefined }}>
      <thead>
        <tr>
          <th style={{ ...thStyle, width: isMobile ? 24 : 36 }} onClick={() => onSort("status")}>
            S{sortField === "status" ? (sortDir === "asc" ? " \u25B2" : " \u25BC") : ""}
          </th>
          <th style={{ ...thStyle, width: isMobile ? 24 : 36 }} onClick={() => onSort("priority")}>
            P{sortField === "priority" ? (sortDir === "asc" ? " \u25B2" : " \u25BC") : ""}
          </th>
          <th style={thStyle} onClick={() => onSort("title")}>
            TITLE{sortField === "title" ? (sortDir === "asc" ? " \u25B2" : " \u25BC") : ""}
          </th>
          <th style={{ ...thStyle, width: isMobile ? 60 : 100 }} onClick={() => onSort("assignee")}>
            ASSIGNEE{sortField === "assignee" ? (sortDir === "asc" ? " \u25B2" : " \u25BC") : ""}
          </th>
          {!isMobile && (
            <th style={{ ...thStyle, width: 90 }} onClick={() => onSort("createdBy")}>
              BY{sortField === "createdBy" ? (sortDir === "asc" ? " \u25B2" : " \u25BC") : ""}
            </th>
          )}
          <th style={{ ...thStyle, width: 70 }} onClick={() => onSort("createdAt")}>
            AGE{sortField === "createdAt" ? (sortDir === "asc" ? " \u25B2" : " \u25BC") : ""}
          </th>
        </tr>
      </thead>
      <tbody>
        {tasks.length === 0 ? (
          <tr>
            <td colSpan={isMobile ? 5 : 6} style={{ textAlign: "center", padding: "24px 0", color: "var(--text-muted)", fontSize: 13 }}>
              {tasksLoaded ? "No tasks" : "Loading..."}
            </td>
          </tr>
        ) : (
          tasks.map((task) => (
            <tr
              key={task.id}
              onClick={() => onSelect(task)}
              style={{
                cursor: "pointer",
                background: task.id === selectedId ? "var(--bg-hover)" : "transparent",
                borderBottom: "1px solid var(--border-subtle)",
                opacity: task.status === "done" ? 0.5 : 1,
              }}
              onMouseEnter={(e) => {
                if (task.id !== selectedId) e.currentTarget.style.background = "var(--bg-hover)";
              }}
              onMouseLeave={(e) => {
                if (task.id !== selectedId) e.currentTarget.style.background = "transparent";
              }}
            >
              <td style={{ padding: cellPad }}>
                <span
                  style={{
                    display: "inline-block",
                    width: 8,
                    height: 8,
                    borderRadius: "50%",
                    background: STATUS_COLORS[task.status],
                    boxShadow: task.status === "open" || task.status === "in_progress" ? `0 0 6px ${STATUS_COLORS[task.status]}` : "none",
                  }}
                  title={STATUS_LABELS[task.status]}
                />
              </td>
              <td style={{ padding: cellPad }}>
                {task.priority && (
                  <span
                    style={{
                      fontSize: 10,
                      fontWeight: 700,
                      fontFamily: "'JetBrains Mono',monospace",
                      color: PRIORITY_COLORS[task.priority],
                    }}
                  >
                    {task.priority}
                  </span>
                )}
              </td>
              <td
                style={{
                  padding: cellPad,
                  fontSize: 13,
                  textDecoration: task.status === "done" ? "line-through" : "none",
                  maxWidth: isMobile ? 0 : 300,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {task.title}
                {task.description && <span style={{ color: "var(--text-hint)", fontWeight: 400 }}> | {task.description}</span>}
              </td>
              <td
                style={{
                  padding: cellPad,
                  fontSize: 11,
                  color: "var(--text-dim)",
                  fontFamily: "'JetBrains Mono',monospace",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {renderName(task.assignee)}
              </td>
              {!isMobile && <td style={{ padding: cellPad, fontSize: 11, color: "var(--text-hint)", fontFamily: "'JetBrains Mono',monospace" }}>{renderName(task.createdBy)}</td>}
              <td style={{ padding: cellPad, fontSize: 10, color: "var(--text-hint)", fontFamily: "'JetBrains Mono',monospace", whiteSpace: "nowrap" }}>{timeAgo(task.createdAt)}</td>
            </tr>
          ))
        )}
      </tbody>
    </table>
  );
}
