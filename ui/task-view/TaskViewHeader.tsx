import type { TaskRoomScope, TaskStatusFilter } from "./taskFilters.ts";

type TaskViewHeaderProps = {
  isMobile: boolean;
  shownCount: number;
  filterStatus: TaskStatusFilter;
  setFilterStatus: (status: TaskStatusFilter) => void;
  roomScope: TaskRoomScope;
  setRoomScope: (scope: TaskRoomScope) => void;
  rooms: { id: string; name: string }[];
  filterAssignee: string;
  setFilterAssignee: (assignee: string) => void;
  selectStyle: React.CSSProperties;
  onClose: () => void;
  onCreate: () => void;
};

export function TaskViewHeader({
  isMobile,
  shownCount,
  filterStatus,
  setFilterStatus,
  roomScope,
  setRoomScope,
  rooms,
  filterAssignee,
  setFilterAssignee,
  selectStyle,
  onClose,
  onCreate,
}: TaskViewHeaderProps) {
  return (
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
          <span style={{ fontSize: 11, color: "var(--text-muted)", fontFamily: "'JetBrains Mono',monospace" }}>{shownCount} shown</span>
        </div>
        <button
          onClick={onCreate}
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
        <select
          value={roomScope}
          onChange={(event) => setRoomScope(event.target.value)}
          title="Filter tasks and set where new tasks are filed"
          style={isMobile ? { ...selectStyle, flex: 1 } : selectStyle}
        >
          <option value="all">All rooms</option>
          <option value="global">Office-wide</option>
          {rooms.map((room) => (
            <option key={room.id} value={room.id}>
              {room.name}
            </option>
          ))}
        </select>
        <select value={filterStatus} onChange={(event) => setFilterStatus(event.target.value as TaskStatusFilter)} style={isMobile ? { ...selectStyle, flex: 1 } : selectStyle}>
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
            onChange={(event) => setFilterAssignee(event.target.value)}
            placeholder="Filter assignee..."
            style={{ ...selectStyle, width: 130 }}
            onKeyDown={(event) => event.stopPropagation()}
          />
        )}
      </div>
    </div>
  );
}
