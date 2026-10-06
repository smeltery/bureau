import { useMemo } from "react";
import { useAppState, useDispatch } from "../store.tsx";
import { send } from "../ws.ts";
import { RoomSettingsModal } from "../components/modals/RoomSettingsModal.tsx";
import type { PresenceInfo } from "../../shared/types.ts";
import { RoomContextMenu } from "./RoomContextMenu.tsx";
import { TotalOnlineChip } from "./RoomPresenceChips.tsx";
import { RoomTabItem } from "./RoomTabItem.tsx";
import { TuckedRooms } from "./TuckedRooms.tsx";
import { useRoomTabInteractions } from "./useRoomTabInteractions.ts";

export function RoomTabBar() {
  const { agents, currentRoom, rooms, needsAttention, presences, totalOnlineUsers, sessionContext, lobbyOpen } = useAppState();
  const roomCount = rooms.length;
  const roomNames = rooms.map((r) => r.name);
  const dispatch = useDispatch();
  const selfConnectionId = sessionContext?.connectionId ?? null;
  const {
    viewError,
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
      <button
        type="button"
        data-lobby-tab
        onClick={() => dispatch({ type: "set_lobby_open", open: true })}
        style={{
          flexShrink: 0,
          border: lobbyOpen ? "1px solid var(--accent)" : "1px solid transparent",
          background: lobbyOpen ? "var(--accent-bg)" : "transparent",
          color: lobbyOpen ? "var(--accent)" : "var(--text-dim)",
          borderRadius: 6,
          padding: "2px 10px",
          fontSize: 12,
          fontWeight: 600,
          fontFamily: "'DM Sans', sans-serif",
          cursor: "pointer",
          height: 24,
        }}
      >
        Lobby
      </button>
      {Array.from({ length: roomCount }, (_, i) => {
        const isActive = !lobbyOpen && i === currentRoom;
        const roomAgents = agents.filter((a) => a.room === i);
        const hasAttention = roomAgents.some((a) => needsAttention.has(a.id));
        const displayName = roomNames[i] ?? `Room ${i + 1}`;
        const roomPresences = presencesByRoom.get(i) ?? [];

        return (
          <RoomTabItem
            key={rooms[i].id}
            agents={roomAgents}
            cancelEdit={cancelEdit}
            cancelLongPress={cancelLongPress}
            commitEdit={commitEdit}
            displayName={displayName}
            dragFrom={dragFrom}
            dragOver={dragOver}
            editValue={editValue}
            editingRoom={editingRoom}
            hasAttention={hasAttention}
            index={i}
            inputRef={inputRef}
            isActive={isActive}
            longPressFired={longPressFired}
            onDragEnd={handleDragEnd}
            onDragLeave={handleDragLeave}
            onDragOver={handleDragOver}
            onDragStart={handleDragStart}
            onDrop={handleDrop}
            onSelect={(room) => dispatch({ type: "set_current_room", room })}
            onTouchStart={handleTouchStart}
            openCtxMenu={openCtxMenu}
            room={rooms[i]}
            roomCount={roomCount}
            roomPresences={roomPresences}
            selfConnectionId={selfConnectionId}
            setEditValue={setEditValue}
            startEditing={startEditing}
          />
        );
      })}
      <TuckedRooms />
      {viewError && <span role="alert">{viewError}</span>}
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
