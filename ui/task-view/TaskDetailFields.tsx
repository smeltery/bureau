import { useI18n } from "../i18n.tsx";
import type { CSSProperties } from "react";
import type { TaskItem, TaskPriority, TaskStatus } from "../../shared/types.ts";
import { dialogInput, dialogLabel } from "../components/modals/dialog-styles.ts";
import { ExpandableTextarea } from "../components/modals/ExpandableTextarea.tsx";
import { timeAgo } from "../utils/time.ts";

export function TaskDetailFields({
  agents,
  assignee,
  description,
  fullScreen,
  mode,
  priority,
  roomId,
  rooms,
  status,
  task,
  title,
  createRoomLocked = false,
  onAssigneeChange,
  onDescriptionChange,
  onPriorityChange,
  onRoomChange,
  onSave,
  onStatusChange,
  onTitleChange,
}: {
  agents: { name: string }[];
  assignee: string;
  description: string;
  fullScreen: boolean;
  mode: "edit" | "create";
  priority: TaskPriority | "";
  roomId: string;
  rooms: { id: string; name: string }[];
  status: TaskStatus;
  task?: TaskItem;
  title: string;
  createRoomLocked?: boolean;
  onAssigneeChange: (value: string) => void;
  onDescriptionChange: (value: string) => void;
  onPriorityChange: (value: TaskPriority | "") => void;
  onRoomChange: (value: string) => void;
  onSave: () => void;
  onStatusChange: (value: TaskStatus) => void;
  onTitleChange: (value: string) => void;
}) {
  const { t, language } = useI18n();
  const inputStyle: CSSProperties = {
    ...dialogInput,
    padding: "8px 10px",
    borderRadius: 6,
    fontSize: 13,
  };

  const labelStyle: CSSProperties = dialogLabel;

  return (
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
        <label style={labelStyle}>{t("tasks.field.title")}</label>
        <input
          autoFocus={mode === "create"}
          aria-label={t("tasks.field.title")}
          value={title}
          onChange={(e) => onTitleChange(e.target.value)}
          style={inputStyle}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.nativeEvent.isComposing) onSave();
            e.stopPropagation();
          }}
        />
      </div>

      <div onKeyDown={(e) => e.stopPropagation()}>
        <label style={labelStyle}>{t("tasks.field.description")}</label>
        <ExpandableTextarea value={description} onChange={onDescriptionChange} title={t("tasks.field.description")} rows={3} style={{ ...inputStyle, resize: "vertical" }} />
      </div>

      <div style={{ display: "flex", gap: 10 }}>
        <div style={{ flex: 1 }}>
          <label style={labelStyle}>{t("tasks.priority")}</label>
          <select aria-label={t("tasks.priority")} value={priority} onChange={(e) => onPriorityChange(e.target.value as TaskPriority | "")} style={inputStyle}>
            <option value="">{t("common.none")}</option>
            <option value="P0">P0</option>
            <option value="P1">P1</option>
            <option value="P2">P2</option>
            <option value="P3">P3</option>
          </select>
        </div>
        <div style={{ flex: 1 }}>
          <label style={labelStyle}>{t("tasks.field.status")}</label>
          <select aria-label={t("tasks.field.status")} value={status} onChange={(e) => onStatusChange(e.target.value as TaskStatus)} style={inputStyle}>
            <option value="open">{t("tasks.status.open")}</option>
            <option value="in_progress">{t("tasks.status.inProgress")}</option>
            <option value="backlog">{t("tasks.status.backlog")}</option>
            <option value="done">{t("tasks.status.done")}</option>
            <option value="obsolete">{t("tasks.status.obsolete")}</option>
          </select>
        </div>
      </div>

      <div>
        <label style={labelStyle}>{t("tasks.field.assignee")}</label>
        <input
          aria-label={t("tasks.field.assignee")}
          value={assignee}
          onChange={(e) => onAssigneeChange(e.target.value)}
          style={inputStyle}
          placeholder={t("tasks.unassigned")}
          onKeyDown={(e) => e.stopPropagation()}
        />
        {agents.length > 0 && (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginTop: 6 }}>
            {agents.map((agent) => (
              <button
                key={agent.name}
                onClick={() => onAssigneeChange(agent.name)}
                style={{
                  padding: "3px 8px",
                  borderRadius: 6,
                  border: `1px solid ${assignee === agent.name ? "var(--accent)" : "var(--border)"}`,
                  background: assignee === agent.name ? "var(--accent-muted, rgba(88,166,255,0.15))" : "var(--btn-surface)",
                  color: assignee === agent.name ? "var(--accent)" : "var(--text-muted)",
                  fontSize: 10,
                  cursor: "pointer",
                  fontFamily: "'JetBrains Mono',monospace",
                  whiteSpace: "nowrap",
                }}
              >
                {agent.name}
              </button>
            ))}
          </div>
        )}
      </div>

      <div>
        <label style={labelStyle}>{mode === "create" ? t("tasks.createIn") : t("common.room")}</label>
        {mode === "create" && createRoomLocked ? (
          <div style={{ ...inputStyle, background: "var(--bg-subtle)" }}>{roomId ? (rooms.find((room) => room.id === roomId)?.name ?? t("tasks.unknownRoom")) : t("tasks.officeWide")}</div>
        ) : (
          <select aria-label={mode === "create" ? t("tasks.createIn") : t("common.room")} value={roomId} onChange={(e) => onRoomChange(e.target.value)} style={inputStyle}>
            <option value="">{t("tasks.officeWide")}</option>
            {rooms.map((room) => (
              <option key={room.id} value={room.id}>
                {room.name}
              </option>
            ))}
          </select>
        )}
      </div>

      {mode === "edit" && task && (
        <div style={{ fontSize: 11, color: "var(--text-hint)", fontFamily: "'JetBrains Mono',monospace" }}>{t("tasks.created", { name: task.createdBy, age: timeAgo(task.createdAt, language) })}</div>
      )}
    </div>
  );
}
