import type { AgentOutfit } from "../../shared/types.ts";
import { Character } from "./scene/Character.tsx";

// Decorative lobby host. Click opens team chat — not a live agent desk.
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

export function LobbyReceptionist({ onOpenTeamChat }: { onOpenTeamChat?: () => void }) {
  return (
    <g data-receptionist="lobby-host" data-no-pan="" style={{ pointerEvents: "all", cursor: onOpenTeamChat ? "pointer" : "default" }} onClick={onOpenTeamChat}>
      <title>Team chat</title>
      <rect x={-HALF_W * SCALE - 4} y={-FEET_Y * SCALE - 12} width={HALF_W * 2 * SCALE + 8} height={FEET_Y * SCALE + 14} fill="transparent" />
      <g transform={`translate(${-HALF_W * SCALE} ${-FEET_Y * SCALE}) scale(${SCALE})`}>
        <Character state="idle" outfit={HOST_OUTFIT} />
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
            Team chat
          </div>
        </div>
      </foreignObject>
    </g>
  );
}
