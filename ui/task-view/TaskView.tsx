import { useState, useRef, useEffect, useMemo } from "react";
import { useAppState } from "../store.tsx";
import type { TaskStatus } from "../../shared/types.ts";
import { TaskDetailPanel } from "./TaskDetailPanel.tsx";
import { TaskTable } from "./TaskTable.tsx";
import { PRIORITY_ORDER, STATUS_ORDER, type SortDir, type SortField } from "./constants.ts";

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

  function handleSelectTask(taskId: string) {
    if (taskId === selectedId) {
      tryClosePanel();
      return;
    }
    if (panelOpen) {
      tryClosePanel();
      pendingSelectRef.current = taskId;
      return;
    }
    setSelectedId(taskId);
    setCreating(false);
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
            <TaskTable
              tasks={filtered}
              tasksLoaded={tasksLoaded}
              selectedId={selectedId}
              isMobile={isMobile}
              cellPad={cellPad}
              thStyle={thStyle}
              sortField={sortField}
              sortDir={sortDir}
              onSort={handleSort}
              onSelect={(task) => handleSelectTask(task.id)}
              renderName={renderName}
            />
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

      {/* Mobile detail panel as full-page */}
      {isMobile &&
        (creating ? (
          <TaskDetailPanel closeRef={closeRef} mode="create" onClose={() => setCreating(false)} username={username} agents={agents} fullScreen />
        ) : selectedTask ? (
          <TaskDetailPanel closeRef={closeRef} task={selectedTask} onClose={() => setSelectedId(null)} username={username} agents={agents} fullScreen />
        ) : null)}
    </div>
  );
}
