import { useEffect, useState } from "react";
import { send } from "../ws.ts";
import type { TaskItem, TaskPriority, TaskStatus } from "../../shared/types.ts";
import { timeAgo } from "../utils/time.ts";
import { dialogInput, dialogLabel } from "../components/modals/dialog-styles.ts";
import { TaskDetailFooter } from "./TaskDetailFooter.tsx";

export function TaskDetailPanel({
  task,
  onClose,
  username,
  mode = "edit",
  agents = [],
  closeRef,
  fullScreen = false,
}: {
  task?: TaskItem;
  onClose: () => void;
  username: string;
  mode?: "edit" | "create";
  agents?: { name: string }[];
  closeRef?: React.MutableRefObject<(() => void) | null>;
  fullScreen?: boolean;
}) {
  const [title, setTitle] = useState(task?.title || "");
  const [description, setDescription] = useState(task?.description || "");
  const [priority, setPriority] = useState<TaskPriority | "">(task?.priority || "");
  const [status, setStatus] = useState<TaskStatus>(task?.status || "open");
  const [assignee, setAssignee] = useState(task?.assignee || "");

  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    if (task) {
      setTitle(task.title);
      setDescription(task.description || "");
      setPriority(task.priority || "");
      setStatus(task.status);
      setAssignee(task.assignee || "");
    } else {
      setTitle("");
      setDescription("");
      setPriority("");
      setStatus("open");
      setAssignee("");
    }
    setConfirmDelete(false);
    setConfirmDiscard(false);
  }, [task]);

  function isDirty(): boolean {
    if (mode === "create") {
      return !!(title.trim() || description.trim() || priority || assignee.trim());
    }
    if (!task) return false;
    return title !== task.title || description !== (task.description || "") || priority !== (task.priority || "") || status !== task.status || assignee !== (task.assignee || "");
  }

  function requestClose() {
    if (isDirty()) {
      setConfirmDiscard(true);
    } else {
      onClose();
    }
  }

  // No deps — must run every render so the ref always has a fresh closure
  // that captures the current form state for the dirty check.
  useEffect(() => {
    if (closeRef) closeRef.current = requestClose;
    return () => {
      if (closeRef) closeRef.current = null;
    };
  });

  function handleSave() {
    if (!title.trim()) return;
    if (mode === "create") {
      send({
        type: "add_task",
        title: title.trim(),
        description: description.trim() || undefined,
        priority: priority || undefined,
        assignee: assignee.trim() || undefined,
        username,
      });
    } else if (task) {
      send({
        type: "update_task",
        id: task.id,
        changes: {
          title: title.trim(),
          description: description.trim() || undefined,
          priority: priority || undefined,
          status,
          assignee: assignee.trim() || undefined,
        },
      });
    }
    onClose();
  }

  function handleDelete() {
    if (!confirmDelete) {
      setConfirmDelete(true);
      return;
    }
    if (task) send({ type: "delete_task", id: task.id });
    onClose();
  }

  const inputStyle: React.CSSProperties = {
    ...dialogInput,
    padding: "8px 10px",
    borderRadius: 6,
    fontSize: 13,
  };

  const labelStyle: React.CSSProperties = dialogLabel;

  // Mobile full-page uses --bg-base (opaque) since --bg-surface is rgba(...,~0.95)
  // and would show the underlying task table through. Desktop side-panel keeps
  // --bg-surface for its elevated look.
  const outerStyle: React.CSSProperties = fullScreen
    ? {
        position: "fixed",
        inset: 0,
        zIndex: 900,
        background: "var(--bg-base)",
        display: "flex",
        flexDirection: "column",
        animation: "hudIn 0.15s ease-out",
      }
    : {
        width: 340,
        maxWidth: "100%",
        borderLeft: "1px solid var(--border-subtle)",
        background: "var(--bg-surface)",
        display: "flex",
        flexDirection: "column",
        animation: "hudIn 0.15s ease-out",
        flexShrink: 0,
      };

  return (
    <div style={outerStyle}>
      {/* Sticky header */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          padding: fullScreen ? "max(14px, env(safe-area-inset-top, 0px)) 20px 12px" : "20px 24px 12px",
          borderBottom: "1px solid var(--border-subtle)",
          flexShrink: 0,
        }}
      >
        <span style={{ fontSize: 13, fontWeight: 600, color: "var(--text-primary)" }}>{mode === "create" ? "New Task" : `#${task!.id}`}</span>
        <button
          onClick={requestClose}
          style={{
            background: "none",
            border: "none",
            color: "var(--text-muted)",
            fontSize: 22,
            lineHeight: 1,
            cursor: "pointer",
            padding: "4px 10px",
          }}
        >
          &times;
        </button>
      </div>

      {/* Scrollable body — minHeight:0 lets the flex child shrink so it scrolls
          rather than the outer container. overscrollBehavior:contain prevents
          touch-passthrough to underlying scroll on iOS. */}
      <div
        style={{
          flex: 1,
          minHeight: 0,
          overflowY: "auto",
          overscrollBehavior: "contain",
          padding: fullScreen ? "14px 20px" : "14px 24px",
          display: "flex",
          flexDirection: "column",
          gap: 14,
        }}
      >
        <div>
          <label style={labelStyle}>Title</label>
          <input
            autoFocus={mode === "create"}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            style={inputStyle}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.nativeEvent.isComposing) handleSave();
              e.stopPropagation();
            }}
          />
        </div>

        <div>
          <label style={labelStyle}>Description</label>
          <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3} style={{ ...inputStyle, resize: "vertical" }} onKeyDown={(e) => e.stopPropagation()} />
        </div>

        <div style={{ display: "flex", gap: 10 }}>
          <div style={{ flex: 1 }}>
            <label style={labelStyle}>Priority</label>
            <select value={priority} onChange={(e) => setPriority(e.target.value as TaskPriority | "")} style={inputStyle}>
              <option value="">None</option>
              <option value="P0">P0</option>
              <option value="P1">P1</option>
              <option value="P2">P2</option>
              <option value="P3">P3</option>
            </select>
          </div>
          <div style={{ flex: 1 }}>
            <label style={labelStyle}>Status</label>
            <select value={status} onChange={(e) => setStatus(e.target.value as TaskStatus)} style={inputStyle}>
              <option value="open">Open</option>
              <option value="in_progress">In Progress</option>
              <option value="backlog">Backlog</option>
              <option value="done">Done</option>
            </select>
          </div>
        </div>

        <div>
          <label style={labelStyle}>Assignee</label>
          <input value={assignee} onChange={(e) => setAssignee(e.target.value)} style={inputStyle} placeholder="Unassigned" onKeyDown={(e) => e.stopPropagation()} />
          {agents.length > 0 && (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginTop: 6 }}>
              {agents.map((a) => (
                <button
                  key={a.name}
                  onClick={() => setAssignee(a.name)}
                  style={{
                    padding: "3px 8px",
                    borderRadius: 6,
                    border: `1px solid ${assignee === a.name ? "var(--accent)" : "var(--border)"}`,
                    background: assignee === a.name ? "var(--accent-muted, rgba(88,166,255,0.15))" : "var(--btn-surface)",
                    color: assignee === a.name ? "var(--accent)" : "var(--text-muted)",
                    fontSize: 10,
                    cursor: "pointer",
                    fontFamily: "'JetBrains Mono',monospace",
                    whiteSpace: "nowrap",
                  }}
                >
                  {a.name}
                </button>
              ))}
            </div>
          )}
        </div>

        {mode === "edit" && task && (
          <div style={{ fontSize: 11, color: "var(--text-hint)", fontFamily: "'JetBrains Mono',monospace" }}>
            Created by {task.createdBy} &middot; {timeAgo(task.createdAt)}
          </div>
        )}
      </div>

      <TaskDetailFooter
        confirmDelete={confirmDelete}
        confirmDiscard={confirmDiscard}
        fullScreen={fullScreen}
        mode={mode}
        title={title}
        onCancelDiscard={() => setConfirmDiscard(false)}
        onClose={onClose}
        onDelete={handleDelete}
        onSave={handleSave}
        setConfirmDelete={setConfirmDelete}
      />
    </div>
  );
}
