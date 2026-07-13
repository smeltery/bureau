import { useMemo } from "react";
import { useAppState, useDispatch } from "../store.tsx";
import { send } from "../ws.ts";
import { RoomSettingsModal } from "../components/modals/RoomSettingsModal.tsx";
import type { PresenceInfo } from "../../shared/types.ts";
import { RoomContextMenu } from "./RoomContextMenu.tsx";
import { MiniGhostCluster, TotalOnlineChip } from "./RoomPresenceChips.tsx";
import { useRoomTabInteractions } from "./useRoomTabInteractions.ts";

export function RoomTabBar() {
  const { agents, currentRoom, rooms, needsAttention, presences, totalOnlineUsers, sessionContext } = useAppState();
  const roomCount = rooms.length;
  const roomNames = rooms.map((r) => r.name);
  const dispatch = useDispatch();
  const selfConnectionId = sessionContext?.connectionId ?? null;
  const {
    cancelEdit,
    cancelLongPress,
    commitEdit,
    ctxMenu,
    dragFrom,
    dragOver,
    editingRoom,
    editValue,
    handleDragEnd,
    handleDragLeave,
    handleDragOver,
    handleDragStart,
    handleDrop,
    handleTouchStart,
    inputRef,
    longPressFired,
    openCtxMenu,
    setCtxMenu,
    setEditValue,
    setSettingsRoomId,
    settingsRoomId,
    startEditing,
  } = useRoomTabInteractions(rooms, roomNames);
  const presencesByRoom = useMemo(() => {
    const buckets = new Map<number, PresenceInfo[]>();
    for (const presence of presences) {
      const roomIdx = presence.currentRoomId ? rooms.findIndex((room) => room.id === presence.currentRoomId) : presence.currentRoom;
      if (roomIdx === null || roomIdx < 0) continue;
      const list = buckets.get(roomIdx);
      if (list) list.push(presence);
      else buckets.set(roomIdx, [presence]);
    }
    return buckets;
  }, [presences, rooms]);

  // Always visible so room controls (including add room) are discoverable.

  return (
    <div
      className="hide-scrollbar"
      style={{
        display: "flex",
        alignItems: "center",
        gap: 2,
        padding: "0 12px",
        height: 32,
        background: "var(--bg-hud)",
        borderBottom: "1px solid var(--border-subtle)",
        overflowX: "auto",
        overflowY: "hidden",
        scrollbarWidth: "none",
        flexShrink: 0,
        zIndex: 500,
      }}
    >
      {Array.from({ length: roomCount }, (_, i) => {
        const isActive = i === currentRoom;
        const roomAgents = agents.filter((a) => a.room === i);
        const hasAttention = roomAgents.some((a) => needsAttention.has(a.id));
        const isEmpty = roomAgents.length === 0;
        const displayName = roomNames[i] ?? `Room ${i + 1}`;
        const isDragging = dragFrom === i;
        const isDropTarget = dragOver === i;
        const roomPresences = presencesByRoom.get(i) ?? [];

        return (
          <div
            key={i}
            draggable={editingRoom !== i && roomCount > 1}
            onDragStart={(e) => handleDragStart(e, i)}
            onDragOver={(e) => handleDragOver(e, i)}
            onDragLeave={handleDragLeave}
            onDrop={(e) => handleDrop(e, i)}
            onDragEnd={handleDragEnd}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 4,
              position: "relative",
              flexShrink: 0,
              opacity: isDragging ? 0.4 : 1,
              borderLeft: isDropTarget && dragFrom !== null && dragFrom > i ? "2px solid var(--accent)" : "2px solid transparent",
              borderRight: isDropTarget && dragFrom !== null && dragFrom < i ? "2px solid var(--accent)" : "2px solid transparent",
              transition: "opacity 0.15s",
            }}
          >
            {/* Right-click / long-press opens context menu (doesn't switch rooms) */}
            {editingRoom === i ? (
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
                  dispatch({ type: "set_current_room", room: i });
                }}
                onDoubleClick={(e) => {
                  e.preventDefault();
                  startEditing(i);
                }}
                onContextMenu={(e) => {
                  e.preventDefault();
                  openCtxMenu(i, e.clientX, e.clientY);
                }}
                onTouchStart={(e) => handleTouchStart(e, i)}
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
                <span
                  style={{
                    color: "var(--text-hint)",
                    fontSize: 9,
                    marginLeft: 4,
                  }}
                >
                  {roomAgents.length}/8
                </span>
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
            {/* Close button: only for empty rooms that aren't Room 1 */}
            {i > 0 && isEmpty && editingRoom !== i && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  const rid = rooms[i]?.id;
                  if (rid) send({ type: "close_room", roomId: rid });
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
      })}
      {/* Add room button */}
      <button
        onClick={() => send({ type: "create_room" })}
        style={{
          padding: "4px 8px",
          borderRadius: 6,
          border: "1px dashed var(--border)",
          background: "transparent",
          color: "var(--text-hint)",
          fontSize: 12,
          cursor: "pointer",
          fontFamily: "'JetBrains Mono',monospace",
          marginLeft: 4,
          flexShrink: 0,
        }}
        title="Create new room"
      >
        +
      </button>
      <TotalOnlineChip count={totalOnlineUsers} />

      {ctxMenu && <RoomContextMenu ctxMenu={ctxMenu} rooms={rooms} agents={agents} onClose={() => setCtxMenu(null)} onRename={startEditing} onSettings={setSettingsRoomId} />}

      {settingsRoomId && <RoomSettingsModal roomId={settingsRoomId} onClose={() => setSettingsRoomId(null)} />}
    </div>
  );
}
