import type { AgentInfo, RoomWire } from "../../shared/types.ts";
import { useState } from "react";
import { saveRoomView } from "./room-view.ts";
import { send } from "../ws.ts";

export function RoomContextMenu({
  ctxMenu,
  rooms,
  agents,
  onClose,
  onRename,
  onSettings,
}: {
  ctxMenu: { roomIdx: number; x: number; y: number };
  rooms: RoomWire[];
  agents: AgentInfo[];
  onClose: () => void;
  onRename: (roomIdx: number) => void;
  onSettings: (roomId: string) => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const room = rooms[ctxMenu.roomIdx];
  if (!room) return null;
  const roomAgents = agents.filter((a) => a.room === ctxMenu.roomIdx);
  const canClose = ctxMenu.roomIdx > 0 && roomAgents.length === 0;
  return (
    <div
      onClick={(e) => e.stopPropagation()}
      style={{
        position: "fixed",
        left: Math.min(ctxMenu.x, window.innerWidth - 180),
        top: Math.min(ctxMenu.y, window.innerHeight - 140),
        background: "var(--bg-overlay)",
        border: "1px solid var(--border-light)",
        borderRadius: 8,
        boxShadow: "0 10px 30px var(--shadow-heavy)",
        padding: 4,
        minWidth: 160,
        zIndex: 950,
        fontFamily: "'DM Sans',sans-serif",
        fontSize: 12,
      }}
    >
      <button
        style={ctxItemStyle}
        onClick={() => {
          onClose();
          onRename(ctxMenu.roomIdx);
        }}
      >
        Rename
      </button>
      <button
        style={ctxItemStyle}
        onClick={() => {
          onClose();
          onSettings(room.id);
        }}
      >
        Room settings…
      </button>
      <button
        style={ctxItemStyle}
        onClick={() => {
          void saveRoomView(
            "shown",
            rooms.filter((r) => r.id !== room.id).map((r) => r.id),
          )
            .then(onClose)
            .catch((err: unknown) => setError(err instanceof Error ? err.message : "Could not tuck room"));
        }}
      >
        Tuck room
      </button>
      {error && <span role="alert">{error}</span>}
      <button
        style={{ ...ctxItemStyle, color: canClose ? "var(--text-dim)" : "var(--text-ghost)", cursor: canClose ? "pointer" : "not-allowed" }}
        disabled={!canClose}
        onClick={() => {
          onClose();
          if (canClose) send({ type: "close_room", roomId: room.id });
        }}
      >
        Close room
      </button>
    </div>
  );
}

const ctxItemStyle: React.CSSProperties = {
  display: "block",
  width: "100%",
  textAlign: "left",
  padding: "7px 12px",
  background: "transparent",
  border: "none",
  color: "var(--text-dim)",
  fontSize: 12,
  cursor: "pointer",
  fontFamily: "'DM Sans',sans-serif",
  borderRadius: 4,
};
