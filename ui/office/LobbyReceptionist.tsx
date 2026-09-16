import type { AgentOutfit } from "../../shared/types.ts";
import { Character } from "./scene/Character.tsx";

// Lobby host. Click opens a living receptionist agent's chat when configured
// and visible; otherwise Team chat (current default).
const HOST_OUTFIT: AgentOutfit = {
  hat: "none",
  color: "#3d5a80",
  hair: "#2b2d42",
  hairStyle: "short",
  skin: "#FFD5B8",
  beard: "none",
  accessory: null,
};

const SCALE = 1.2;
const FEET_Y = 64;
const HALF_W = 26;

export function LobbyReceptionist({
  onOpenTeamChat,
  onOpenAgent,
  agent,
}: {
  onOpenTeamChat?: () => void;
  onOpenAgent?: (agentId: string) => void;
  /** Living agent the viewer can access; when set, click opens their chat. */
  agent?: { id: string; name: string; outfit: AgentOutfit } | null;
}) {
  const label = agent ? agent.name : "Team chat";
  const outfit = agent?.outfit ?? HOST_OUTFIT;
  const onClick = agent && onOpenAgent ? () => onOpenAgent(agent.id) : onOpenTeamChat;
  return (
    <g data-receptionist="lobby-host" data-no-pan="" style={{ pointerEvents: "all", cursor: onClick ? "pointer" : "default" }} onClick={onClick}>
      <title>{label}</title>
      <rect x={-HALF_W * SCALE - 4} y={-FEET_Y * SCALE - 12} width={HALF_W * 2 * SCALE + 8} height={FEET_Y * SCALE + 14} fill="transparent" />
      <g transform={`translate(${-HALF_W * SCALE} ${-FEET_Y * SCALE}) scale(${SCALE})`}>
        <Character state="idle" outfit={outfit} />
      </g>
      <foreignObject x={-200} y={-FEET_Y * SCALE - 28} width={400} height={40} style={{ pointerEvents: "none" }}>
        <div style={{ height: "100%", display: "flex", justifyContent: "center", alignItems: "center" }}>
          <div
            style={{
              padding: "3px 10px",
              borderRadius: 999,
              background: "var(--bg-tag)",
              border: "1px solid var(--border)",
              color: "var(--text-primary)",
              fontSize: 11,
              fontWeight: 600,
              fontFamily: "'DM Sans', sans-serif",
              whiteSpace: "nowrap",
            }}
          >
            {label}
          </div>
        </div>
      </foreignObject>
    </g>
  );
}
