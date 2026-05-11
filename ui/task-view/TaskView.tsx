import { useState, useRef, useEffect, useMemo } from "react";
import { useAppState } from "../store.tsx";
import type { TaskStatus } from "../../shared/types.ts";
import { timeAgo } from "../utils/time.ts";
import { TaskDetailPanel } from "./TaskDetailPanel.tsx";
import { PRIORITY_COLORS, PRIORITY_ORDER, STATUS_COLORS, STATUS_LABELS, STATUS_ORDER, type SortDir, type SortField } from "./constants.ts";

export function TaskView({ username, onClose, onFocusAgent }: { username: string; onClose: () => void; onFocusAgent?: (agentId: string) => void }) {
  const { tasks, tasksLoaded, agents, isMobile } = useAppState();
  const [search, setSearch] = useState("");
  const [filterStatus, setFilterStatus] = useState<TaskStatus | "all" | "active">("active");
  const [creating, setCreating] = useState(false);
  const [filterAssignee, setFilterAssignee] = useState("");
  const [sortField, setSortField] = useState<SortField>("createdAt");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const closeRef = useRef<(() => void) | null>(null);
  const pendingSelectRef = useRef<string | null>(null);

  const selectedTask = selectedId ? tasks.find((t) => t.id === selectedId) : null;
  const panelOpen = !!(selectedTask || creating);

  function tryClosePanel() {
    if (closeRef.current) {
      closeRef.current();
    }
  }

  // After a panel closes, apply any pending row selection from a click that triggered the close
  useEffect(() => {
    if (!panelOpen && pendingSelectRef.current) {
      const id = pendingSelectRef.current;
      pendingSelectRef.current = null;
      setSelectedId(id);
    }
  }, [panelOpen]);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.stopPropagation();
        if (panelOpen) {
          tryClosePanel();
        } else {
          onClose();
        }
      }
    }
    window.addEventListener("keydown", handleKey, true);
    return () => window.removeEventListener("keydown", handleKey, true);
  }, [onClose, panelOpen]);

  const agentsByName = useMemo(() => {
    const map = new Map<string, string>(); // lowercase name → agentId
    for (const a of agents) map.set(a.name.toLowerCase(), a.id);
    return map;
  }, [agents]);

  const filtered = useMemo(() => {
    let list = tasks;
    if (filterStatus === "active") {
      list = list.filter((t) => t.status !== "done" && t.status !== "backlog");
    } else if (filterStatus !== "all") {
      list = list.filter((t) => t.status === filterStatus);
    }
    if (search) {
      const q = search.toLowerCase();
      list = list.filter((t) => t.id.toLowerCase().includes(q) || t.title.toLowerCase().includes(q) || (t.description && t.description.toLowerCase().includes(q)));
    }
    if (filterAssignee) {
      const q = filterAssignee.toLowerCase();
      list = list.filter((t) => t.assignee?.toLowerCase().includes(q));
    }
    const sorted = [...list].sort((a, b) => {
      let cmp = 0;
      switch (sortField) {
        case "status":
          cmp = STATUS_ORDER[a.status] - STATUS_ORDER[b.status];
          break;
        case "priority": {
          const pa = a.priority ? PRIORITY_ORDER[a.priority] : 99;
          const pb = b.priority ? PRIORITY_ORDER[b.priority] : 99;
          cmp = pa - pb;
          break;
        }
        case "title":
          cmp = a.title.localeCompare(b.title);
          break;
        case "assignee":
          cmp = (a.assignee || "").localeCompare(b.assignee || "");
          break;
        case "createdBy":
          cmp = a.createdBy.localeCompare(b.createdBy);
          break;
        case "createdAt":
          cmp = a.createdAt - b.createdAt;
          break;
      }
      return sortDir === "asc" ? cmp : -cmp;
    });
    return sorted;
  }, [tasks, filterStatus, search, filterAssignee, sortField, sortDir]);

  function renderName(name: string | undefined) {
    if (!name) return "";
    const agentId = agentsByName.get(name.toLowerCase());
    if (agentId && onFocusAgent) {
      return (
        <span
          onClick={(e) => {
            e.stopPropagation();
            onFocusAgent(agentId);
          }}
          style={{ cursor: "pointer", color: "var(--accent)", textDecoration: "none" }}
          onMouseEnter={(e) => (e.currentTarget.style.textDecoration = "underline")}
          onMouseLeave={(e) => (e.currentTarget.style.textDecoration = "none")}
        >
          {name}
        </span>
      );
    }
    return name;
  }

  function handleSort(field: SortField) {
    if (sortField === field) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortField(field);
      setSortDir("asc");
    }
  }

  const cellPad = isMobile ? "6px 4px" : "8px 10px";

  const thStyle: React.CSSProperties = {
    padding: cellPad,
    fontSize: 10,
    fontWeight: 700,
    color: "var(--text-muted)",
    fontFamily: "'JetBrains Mono',monospace",
    letterSpacing: "0.05em",
    textAlign: "left",
    cursor: "pointer",
    userSelect: "none",
    whiteSpace: "nowrap",
    borderBottom: "1px solid var(--border-subtle)",
  };

  const selectStyle: React.CSSProperties = {
    padding: "7px 12px",
    borderRadius: 6,
    border: "1px solid var(--border)",
    background: "var(--bg-input)",
    color: "var(--text-primary)",
    fontSize: 12,
    minHeight: 36,
    outline: "none",
  };

  return (
    <div
      style={{
        height: isMobile ? "100dvh" : "100vh",
        display: "flex",
        flexDirection: "column",
        background: "var(--bg-base)",
        color: "var(--text-primary)",
      }}
    >
      {/* Header */}
      <div
        style={{
          display: "flex",
          flexDirection: isMobile ? "column" : "row",
          alignItems: isMobile ? "stretch" : "center",
          justifyContent: "space-between",
          padding: isMobile ? "4px 12px 6px" : "0 20px",
          paddingTop: isMobile ? "max(4px, env(safe-area-inset-top, 0px))" : undefined,
          gap: isMobile ? 6 : 0,
          minHeight: 44,
          background: "var(--bg-hud)",
          backdropFilter: "blur(16px)",
          borderBottom: "1px solid var(--border-subtle)",
          flexShrink: 0,
          zIndex: 500,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10, justifyContent: isMobile ? "space-between" : undefined }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
            <button
              onClick={onClose}
              style={{
                background: "none",
                border: "none",
                color: "var(--text-muted)",
                fontSize: 18,
                cursor: "pointer",
                padding: "2px 8px",
              }}
            >
              &larr;
            </button>
            <span style={{ fontSize: 15, fontWeight: 700, letterSpacing: "-0.02em" }}>Tasks</span>
            <span style={{ fontSize: 11, color: "var(--text-muted)", fontFamily: "'JetBrains Mono',monospace" }}>{filtered.length} shown</span>
          </div>
          <button
            onClick={() => {
              setCreating(true);
              setSelectedId(null);
            }}
            style={{
              padding: "4px 10px",
              borderRadius: 6,
              border: "none",
              background: "var(--accent)",
              color: "var(--bg-base)",
              fontSize: 11,
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            Add
          </button>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <select value={filterStatus} onChange={(e) => setFilterStatus(e.target.value as TaskStatus | "all" | "active")} style={isMobile ? { ...selectStyle, flex: 1 } : selectStyle}>
            <option value="active">Open + In Progress</option>
            <option value="open">Open</option>
            <option value="in_progress">In Progress</option>
            <option value="backlog">Backlog</option>
            <option value="done">Done</option>
            <option value="all">All</option>
          </select>
          {!isMobile && (
            <input
              value={filterAssignee}
              onChange={(e) => setFilterAssignee(e.target.value)}
              placeholder="Filter assignee..."
              style={{ ...selectStyle, width: 130 }}
              onKeyDown={(e) => e.stopPropagation()}
            />
          )}
        </div>
      </div>

      {/* Body */}
      <div style={{ flex: 1, display: "flex", overflow: "hidden" }}>
        {/* Table area */}
        <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
          {/* Search bar */}
          <div style={{ display: "flex", gap: 8, padding: isMobile ? "10px 12px" : "10px 20px", borderBottom: "1px solid var(--border-subtle)" }}>
            <input
              ref={inputRef}
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={(e) => e.stopPropagation()}
              placeholder="Search tasks..."
              style={{
                flex: 1,
                padding: "9px 12px",
                borderRadius: 8,
                border: "1px solid var(--border)",
                background: "var(--bg-input)",
                color: "var(--text-primary)",
                fontSize: 13,
                outline: "none",
              }}
            />
          </div>

          {/* Table */}
          <div
            onClick={(e) => {
              // Click on empty table area (not on a row) dismisses the panel
              if (panelOpen && e.target === e.currentTarget) tryClosePanel();
            }}
            style={{ flex: 1, overflowY: "auto", overflowX: isMobile ? "hidden" : "auto" }}
          >
            <table style={{ width: "100%", borderCollapse: "collapse", tableLayout: isMobile ? "fixed" : undefined }}>
              <thead>
                <tr>
                  <th style={{ ...thStyle, width: isMobile ? 24 : 36 }} onClick={() => handleSort("status")}>
                    S{sortField === "status" ? (sortDir === "asc" ? " \u25B2" : " \u25BC") : ""}
                  </th>
                  <th style={{ ...thStyle, width: isMobile ? 24 : 36 }} onClick={() => handleSort("priority")}>
                    P{sortField === "priority" ? (sortDir === "asc" ? " \u25B2" : " \u25BC") : ""}
                  </th>
                  <th style={thStyle} onClick={() => handleSort("title")}>
                    TITLE{sortField === "title" ? (sortDir === "asc" ? " \u25B2" : " \u25BC") : ""}
                  </th>
                  <th style={{ ...thStyle, width: isMobile ? 60 : 100 }} onClick={() => handleSort("assignee")}>
                    ASSIGNEE{sortField === "assignee" ? (sortDir === "asc" ? " \u25B2" : " \u25BC") : ""}
                  </th>
                  {!isMobile && (
                    <th style={{ ...thStyle, width: 90 }} onClick={() => handleSort("createdBy")}>
                      BY{sortField === "createdBy" ? (sortDir === "asc" ? " \u25B2" : " \u25BC") : ""}
                    </th>
                  )}
                  <th style={{ ...thStyle, width: 70 }} onClick={() => handleSort("createdAt")}>
                    AGE{sortField === "createdAt" ? (sortDir === "asc" ? " \u25B2" : " \u25BC") : ""}
                  </th>
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 ? (
                  <tr>
                    <td colSpan={isMobile ? 5 : 6} style={{ textAlign: "center", padding: "24px 0", color: "var(--text-muted)", fontSize: 13 }}>
                      {tasksLoaded ? "No tasks" : "Loading..."}
                    </td>
                  </tr>
                ) : (
                  filtered.map((task) => (
                    <tr
                      key={task.id}
                      onClick={() => {
                        if (task.id === selectedId) {
                          tryClosePanel();
                          return;
                        }
                        if (panelOpen) {
                          tryClosePanel();
                          pendingSelectRef.current = task.id;
                          return;
                        }
                        setSelectedId(task.id);
                        setCreating(false);
                      }}
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
          </div>
        </div>

        {/* Detail panel */}
        {!isMobile &&
          (creating ? (
            <TaskDetailPanel closeRef={closeRef} mode="create" onClose={() => setCreating(false)} username={username} agents={agents} />
          ) : selectedTask ? (
            <TaskDetailPanel closeRef={closeRef} task={selectedTask} onClose={() => setSelectedId(null)} username={username} agents={agents} />
          ) : null)}
      </div>

      {/* Mobile detail panel as overlay */}
      {(selectedTask || creating) && isMobile && (
        <div
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) tryClosePanel();
          }}
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 900,
            background: "rgba(0,0,0,0.55)",
            backdropFilter: "blur(10px)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <div style={{ width: "90%", maxWidth: 380, maxHeight: "80vh", overflowY: "auto", margin: "0 auto", borderRadius: 12, overflow: "hidden" }}>
            {creating ? (
              <TaskDetailPanel closeRef={closeRef} mode="create" onClose={() => setCreating(false)} username={username} agents={agents} />
            ) : (
              <TaskDetailPanel closeRef={closeRef} task={selectedTask!} onClose={() => setSelectedId(null)} username={username} agents={agents} />
            )}
          </div>
        </div>
      )}
    </div>
  );
}
