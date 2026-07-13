import type { DragEvent, MutableRefObject, TouchEvent } from "react";
import type { AgentInfo, PresenceInfo, RoomWire } from "../../shared/types.ts";
import { send } from "../ws.ts";
import { MiniGhostCluster } from "./RoomPresenceChips.tsx";

type RoomTabItemProps = {
  agents: AgentInfo[];
  cancelEdit: () => void;
  cancelLongPress: () => void;
  commitEdit: () => void;
  displayName: string;
  dragFrom: number | null;
  dragOver: number | null;
  editValue: string;
  editingRoom: number | null;
  hasAttention: boolean;
  index: number;
  inputRef: MutableRefObject<HTMLInputElement | null>;
  isActive: boolean;
  longPressFired: MutableRefObject<boolean>;
  onDragEnd: () => void;
  onDragLeave: () => void;
  onDragOver: (event: DragEvent, index: number) => void;
  onDragStart: (event: DragEvent, index: number) => void;
  onDrop: (event: DragEvent, index: number) => void;
  onSelect: (index: number) => void;
  onTouchStart: (event: TouchEvent, index: number) => void;
  openCtxMenu: (roomIdx: number, x: number, y: number) => void;
  room: RoomWire | undefined;
  roomCount: number;
  roomPresences: PresenceInfo[];
  selfConnectionId: string | null;
  setEditValue: (value: string) => void;
  startEditing: (index: number) => void;
};

export function RoomTabItem({
  agents,
  cancelEdit,
  cancelLongPress,
  commitEdit,
  displayName,
  dragFrom,
  dragOver,
  editValue,
  editingRoom,
  hasAttention,
  index,
  inputRef,
  isActive,
  longPressFired,
  onDragEnd,
  onDragLeave,
  onDragOver,
  onDragStart,
  onDrop,
  onSelect,
  onTouchStart,
  openCtxMenu,
  room,
  roomCount,
  roomPresences,
  selfConnectionId,
  setEditValue,
  startEditing,
}: RoomTabItemProps) {
  const isEmpty = agents.length === 0;
  const isDragging = dragFrom === index;
  const isDropTarget = dragOver === index;

  return (
    <div
      draggable={editingRoom !== index && roomCount > 1}
      onDragStart={(e) => onDragStart(e, index)}
      onDragOver={(e) => onDragOver(e, index)}
      onDragLeave={onDragLeave}
      onDrop={(e) => onDrop(e, index)}
      onDragEnd={onDragEnd}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 4,
        position: "relative",
        flexShrink: 0,
        opacity: isDragging ? 0.4 : 1,
        borderLeft: isDropTarget && dragFrom !== null && dragFrom > index ? "2px solid var(--accent)" : "2px solid transparent",
        borderRight: isDropTarget && dragFrom !== null && dragFrom < index ? "2px solid var(--accent)" : "2px solid transparent",
        transition: "opacity 0.15s",
      }}
    >
      {editingRoom === index ? (
        <input
          ref={inputRef}
          value={editValue}
          onChange={(e) => setEditValue(e.target.value)}
          onBlur={commitEdit}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.nativeEvent.isComposing) commitEdit();
            if (e.key === "Escape") cancelEdit();
          }}
          style={{
            padding: "4px 8px",
            borderRadius: 6,
            border: "1px solid var(--accent)",
            background: "var(--bg-input)",
            color: "var(--text-primary)",
            fontSize: 11,
            fontWeight: 600,
            fontFamily: "'JetBrains Mono',monospace",
            letterSpacing: "0.02em",
            outline: "none",
            width: 100,
          }}
        />
      ) : (
        <button
          onClick={(e) => {
            if (longPressFired.current) {
              longPressFired.current = false;
              return;
            }
            (e.target as HTMLElement).blur();
            onSelect(index);
          }}
          onDoubleClick={(e) => {
            e.preventDefault();
            startEditing(index);
          }}
          onContextMenu={(e) => {
            e.preventDefault();
            openCtxMenu(index, e.clientX, e.clientY);
          }}
          onTouchStart={(e) => onTouchStart(e, index)}
          onTouchEnd={cancelLongPress}
          onTouchMove={cancelLongPress}
          onTouchCancel={cancelLongPress}
          style={{
            padding: "4px 12px",
            borderRadius: 6,
            border: isActive ? "1px solid var(--accent)" : "1px solid transparent",
            background: isActive ? "var(--accent-bg)" : "transparent",
            color: isActive ? "var(--accent)" : "var(--text-dim)",
            fontSize: 11,
            fontWeight: 600,
            cursor: "grab",
            fontFamily: "'JetBrains Mono',monospace",
            letterSpacing: "0.02em",
            outline: "none",
            position: "relative",
            display: "inline-flex",
            alignItems: "center",
            whiteSpace: "nowrap",
          }}
        >
          {displayName}
          <span style={{ color: "var(--text-hint)", fontSize: 9, marginLeft: 4 }}>{agents.length}/8</span>
          {hasAttention && !isActive && (
            <span
              style={{
                position: "absolute",
                top: 2,
                right: 2,
                width: 5,
                height: 5,
                borderRadius: "50%",
                background: "var(--purple)",
                boxShadow: "0 0 4px var(--purple)",
              }}
            />
          )}
        </button>
      )}
      <MiniGhostCluster presences={roomPresences} selfConnectionId={selfConnectionId} />
      {index > 0 && isEmpty && editingRoom !== index && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            if (room?.id) send({ type: "close_room", roomId: room.id });
          }}
          style={{
            width: 16,
            height: 16,
            borderRadius: 4,
            border: "none",
            background: "transparent",
            color: "var(--text-hint)",
            fontSize: 10,
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 0,
            lineHeight: 1,
          }}
          title="Close empty room"
        >
          ×
        </button>
      )}
    </div>
  );
}
