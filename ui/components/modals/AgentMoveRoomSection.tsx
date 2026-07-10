import type { AgentInfo, RoomWire } from "../../../shared/types.ts";
import { send } from "../../ws.ts";

export function AgentMoveRoomSection({
  agent,
  agents,
  labelStyle,
  onClose,
  rooms,
}: {
  agent: AgentInfo;
  agents: AgentInfo[];
  labelStyle: React.CSSProperties;
  onClose: () => void;
  rooms: RoomWire[];
}) {
  if (rooms.length <= 1) return null;

  return (
    <>
      <label style={{ ...labelStyle, marginTop: 14 }}>Move to Room</label>
      <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
        {rooms.map((room, i) => {
          if (i === agent.room) return null;
          const roomAgentCount = agents.filter((a) => a.room === i).length;
          const isFull = roomAgentCount >= 8;
          return (
            <button
              key={room.id}
              disabled={isFull}
              onClick={() => {
                send({ type: "move_agent", agentId: agent.id, targetRoomId: room.id });
                onClose();
              }}
              style={{
                padding: "5px 12px",
                borderRadius: 6,
                border: "1px solid var(--border)",
                background: isFull ? "var(--bg-input)" : "var(--btn-surface)",
                color: isFull ? "var(--text-ghost)" : "var(--text-dim)",
                fontSize: 11,
                cursor: isFull ? "not-allowed" : "pointer",
                fontFamily: "'JetBrains Mono',monospace",
                opacity: isFull ? 0.5 : 1,
              }}
            >
              {room.name} ({roomAgentCount}/8)
            </button>
          );
        })}
      </div>
    </>
  );
}
