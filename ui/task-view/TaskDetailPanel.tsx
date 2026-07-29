import { useEffect, useState } from "react";
import { send } from "../ws.ts";
import type { TaskItem, TaskPriority, TaskStatus } from "../../shared/types.ts";
import { CopyButton } from "../components/controls/CopyButton.tsx";
import { TaskDetailFields } from "./TaskDetailFields.tsx";
import { TaskDetailFooter } from "./TaskDetailFooter.tsx";

export function TaskDetailPanel({
  task,
  onClose,
  username,
  mode = "edit",
  agents = [],
  rooms = [],
  defaultRoomId,
  closeRef,
  fullScreen = false,
}: {
  task?: TaskItem;
  onClose: () => void;
  username: string;
  mode?: "edit" | "create";
  agents?: { name: string }[];
  rooms?: { id: string; name: string }[];
  defaultRoomId?: string | null;
  closeRef?: React.MutableRefObject<(() => void) | null>;
  fullScreen?: boolean;
}) {
  const [title, setTitle] = useState(task?.title || "");
  const [description, setDescription] = useState(task?.description || "");
  const [priority, setPriority] = useState<TaskPriority | "">(task?.priority || "");
  const [status, setStatus] = useState<TaskStatus>(task?.status || "open");
  const [assignee, setAssignee] = useState(task?.assignee || "");
  const [roomId, setRoomId] = useState(task?.roomId ?? defaultRoomId ?? "");

  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    if (task) {
      setTitle(task.title);
      setDescription(task.description || "");
      setPriority(task.priority || "");
      setStatus(task.status);
      setAssignee(task.assignee || "");
      setRoomId(task.roomId ?? "");
    } else {
      setTitle("");
      setDescription("");
      setPriority("");
      setStatus("open");
      setAssignee("");
      setRoomId(defaultRoomId ?? "");
    }
    setConfirmDelete(false);
    setConfirmDiscard(false);
  }, [defaultRoomId, task]);

  function isDirty(): boolean {
    if (mode === "create") {
      return !!(title.trim() || description.trim() || priority || assignee.trim() || roomId !== (defaultRoomId ?? ""));
    }
    if (!task) return false;
    return (
      title !== task.title ||
      description !== (task.description || "") ||
      priority !== (task.priority || "") ||
      status !== task.status ||
      assignee !== (task.assignee || "") ||
      roomId !== (task.roomId ?? "")
    );
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
        roomId: roomId || undefined,
        username,
      });
    } else if (task) {
      send({
        type: "update_task",
        id: task.id,
        changes: {
          title: title.trim(),
          description: description.trim() || undefined,
          priority: priority === "" ? null : priority,
          status,
          assignee: assignee.trim() || undefined,
          roomId: roomId || undefined,
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
        {mode === "create" ? (
          <span style={{ fontSize: 13, fontWeight: 600, color: "var(--text-primary)" }}>New Task</span>
        ) : (
          <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
            <span style={{ fontSize: 13, fontWeight: 600, color: "var(--text-primary)", fontFamily: "'JetBrains Mono',monospace" }}>#{task!.id}</span>
            <CopyButton getText={() => task!.id} size={22} />
          </div>
        )}
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

      <TaskDetailFields
        agents={agents}
        assignee={assignee}
        description={description}
        fullScreen={fullScreen}
        mode={mode}
        priority={priority}
        roomId={roomId}
        rooms={rooms}
        status={status}
        task={task}
        title={title}
        onAssigneeChange={setAssignee}
        onDescriptionChange={setDescription}
        onPriorityChange={setPriority}
        onRoomChange={setRoomId}
        onSave={handleSave}
        onStatusChange={setStatus}
        onTitleChange={setTitle}
      />

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
