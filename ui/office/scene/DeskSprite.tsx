import type { AgentState } from "../../../shared/types.ts";
import type { AgentInfo } from "../../../shared/types.ts";
import { DESKS_WITHOUT_PLANT, MUG_VARIANTS, PLANT_VARIANTS, vesselForAgentType, visualDeskState, wrapCwd } from "./deskSpriteData.ts";
import { shortenCwd } from "../../cwd-display.ts";
import { DeskModelItem } from "./DeskModelItem.tsx";

// The vessel says which backend the agent runs on. Ceramic colour still varies
// by desk; Claude always gets a mug, Codex a teacup+saucer, OpenCode a small
// flask/bottle. Empty-desk fixtures keep the mug so the furniture still reads
// as occupied.

export function DeskSprite({ state, deskIndex = 0, cwd, modelFamily, agentType }: { state: AgentState; deskIndex?: number; cwd?: string; modelFamily?: string; agentType?: AgentInfo["agentType"] }) {
  const vs = visualDeskState(state);
  const glow = { working: "#50B86C", waiting_for_response: "#9B59B6", error: "#E85D75", idle: "#223" }[vs];
  const on = vs !== "idle";
  const hasPlant = !DESKS_WITHOUT_PLANT.has(deskIndex);
  const vessel = vesselForAgentType(agentType);
  const leaves = PLANT_VARIANTS[deskIndex % PLANT_VARIANTS.length];
  const [mugBody, mugSide, mugRim, mugLiquid] = MUG_VARIANTS[deskIndex % MUG_VARIANTS.length];
  // Cup drinks read as tea rather than coffee so the vessel and its contents agree.
  const cupLiquid = "#B5701F";
  // Flask liquid — cool amber/teal so it reads apart from mug coffee / cup tea.
  const flaskLiquid = "#3A7A6A";

  const lampId = `lamp-glow-${deskIndex}`;
  const screenClipId = `screen-clip-${deskIndex}`;
  const shortCwd = cwd ? shortenCwd(cwd) : "";

  return (
    <svg width="180" height="140" viewBox="0 0 180 140" overflow="visible">
      <defs>
        <clipPath id={screenClipId}>
          <path d="M66 18 L108 37 L108 60 L66 41 Z" />
        </clipPath>
        <radialGradient id={lampId} cx="50%" cy="40%" r="50%">
          <stop offset="0%" stopColor="#F5D090" stopOpacity="0.45" />
          <stop offset="50%" stopColor="#F5C060" stopOpacity="0.2" />
          <stop offset="100%" stopColor="#F5C060" stopOpacity="0" />
        </radialGradient>
      </defs>

      {/* Shadow under desk */}
      <path d="M45 121 L85 102 Q90 100 95 102 L135 121 Q140 124 135 127 L95 146 Q90 148 85 146 L45 127 Q40 124 45 121 Z" fill="rgba(0,0,0,0.12)" />

      {/* Chair */}
      <path d="M56 95 L90 110 L124 95 L90 80 Z" fill="#2a2a3a" />
      <path d="M56 95 L56 72 L90 57 L90 80 Z" fill="#333345" stroke="#2a2a3a" strokeWidth="0.5" />

      {/* Desk legs — from front panel corners to floor */}
      {/* Left leg */}
      <path d="M40 90 L40 122 L43 124 L43 92 Z" fill="#4A3C2A" />
      <path d="M38 122 L41.5 124 L45 122 L41.5 120 Z" fill="#3E3220" />
      {/* Right leg */}
      <path d="M137 90 L137 122 L140 124 L140 92 Z" fill="#4A3C2A" />
      <path d="M135.5 122 L138.5 124 L141.5 122 L138.5 120 Z" fill="#3E3220" />
      {/* Front leg */}
      <path d="M89 114 L89 144 L91 145 L91 115 Z" fill="#352a1c" />
      <path d="M91 115 L91 145 L93 144 L93 114 Z" fill="#3E3220" />
      {/* Front leg foot */}
      <path d="M87 144 L91 146 L95 144 L91 142 Z" fill="#3E3220" />

      {/* Desktop surface */}
      <path d="M20 62 L90 28 L160 62 L90 96 Z" fill="#5C4C38" />
      <path d="M20 62 L90 96 L90 104 L20 70 Z" fill="#4A3C2A" />
      <path d="M90 96 L160 62 L160 70 L90 104 Z" fill="#3E3220" />

      {/* Front panel */}
      <path d="M40 72 L90 96 L140 72 L140 92 L90 116 L40 92 Z" fill="#3a2e20" />
      <path d="M40 72 L90 96 L90 116 L40 92 Z" fill="#352a1c" />

      {/* Keyboard + Monitor group — shifted NW on desk */}
      <g transform="translate(-12, -6)">
        {/* Keyboard — rendered first (behind monitor) */}
        {/* Top face */}
        <path d="M60 66 L87 79 L114 66 L87 53 Z" fill="#2a2a2a" stroke="#333" strokeWidth="0.4" />
        {/* Front-left face (depth) */}
        <path d="M60 66 L87 79 L87 82 L60 69 Z" fill="#1e1e1e" />
        {/* Front-right face (depth) */}
        <path d="M87 79 L114 66 L114 69 L87 82 Z" fill="#252525" />
        {/* Key rows */}
        <path d="M68 64 L87 73 L106 64" stroke="#3a3a3a" strokeWidth="0.4" fill="none" />
        <path d="M70 66 L87 74 L104 66" stroke="#3a3a3a" strokeWidth="0.4" fill="none" />
        <path d="M72 68 L87 75.5 L102 68" stroke="#3a3a3a" strokeWidth="0.3" fill="none" />
        {/* Individual key hints on top row */}
        <path d="M73 61 L78 58.5" stroke="#3a3a3a" strokeWidth="0.3" fill="none" />
        <path d="M80 57.5 L85 55" stroke="#3a3a3a" strokeWidth="0.3" fill="none" />
        <path d="M89 56 L94 58.5" stroke="#3a3a3a" strokeWidth="0.3" fill="none" />
        <path d="M97 60 L102 62.5" stroke="#3a3a3a" strokeWidth="0.3" fill="none" />

        {/* Monitor stand — rendered second (behind screen) */}
        {/* Stand neck */}
        <path d="M85 52 L91 55 L91 64 L85 61 Z" fill="#2a2a3a" />
        <path d="M91 55 L95 53 L95 62 L91 64 Z" fill="#1a1a28" />
        {/* Stand base — isometric diamond */}
        <path d="M78 64 L90 58 L102 64 L90 70 Z" fill="#2a2a3a" />
        <path d="M78 64 L90 70 L90 72 L78 66 Z" fill="#1a1a28" />
        <path d="M90 70 L102 64 L102 66 L90 72 Z" fill="#222233" />

        {/* Monitor screen — rendered last (in front) */}
        <path d="M64 16 L110 36 L110 62 L64 42 Z" fill="#222233" stroke="#1a1a28" strokeWidth="0.8" />
        {/* Top edge thickness */}
        <path d="M64 16 L110 36 L114 34 L68 14 Z" fill="#2a2a3a" />
        {/* Right edge thickness */}
        <path d="M110 36 L114 34 L114 60 L110 62 Z" fill="#1a1a28" />
        {/* Screen area */}
        <path d="M66 18 L108 37 L108 60 L66 41 Z" fill={on ? "#0d1117" : "#141820"} />
        {on && (
          <path d="M66 18 L108 37 L108 60 L66 41 Z" fill={glow} opacity="0.15">
            <animate attributeName="opacity" values="0.1;0.2;0.1" dur="3s" repeatCount="indefinite" />
          </path>
        )}
        {on && (
          <path d="M66 30 L108 48" stroke={glow} strokeWidth="0.8" opacity="0.3">
            <animate attributeName="d" values="M66 18 L108 37;M66 41 L108 60;M66 18 L108 37" dur="4s" repeatCount="indefinite" />
          </path>
        )}
        {/* CWD text on monitor */}
        {shortCwd && (
          <g clipPath={`url(#${screenClipId})`}>
            <text
              x="68"
              y="24"
              fill={on ? "rgba(180,220,255,0.85)" : "rgba(120,140,160,0.35)"}
              fontSize="5"
              fontFamily="monospace"
              transform="skewY(24)"
              style={{ transformOrigin: "68px 24px", userSelect: "none", pointerEvents: "none" }}
            >
              {wrapCwd(shortCwd).map((line, i) => (
                <tspan key={i} x="68" dy={i === 0 ? 0 : 6}>
                  {line}
                </tspan>
              ))}
            </text>
          </g>
        )}
      </g>

      {/* Mug — Claude. Solid ceramic; colour varies by desk. */}
      {vessel === "mug" && (
        <g>
          <path d="M134 62 L134 55 L146 55 L146 62" fill={mugBody} />
          <path d="M134 55 L134 62 L137 62 L137 55 Z" fill={mugSide} />
          <ellipse cx="140" cy="62" rx="6" ry="3" fill={mugSide} />
          <ellipse cx="140" cy="55" rx="6" ry="3" fill={mugRim} />
          <ellipse cx="140" cy="55.5" rx="4.5" ry="2" fill={mugLiquid} />
          <path d="M146 57 Q152 57 152 60 Q152 63 146 62" fill="none" stroke={mugSide} strokeWidth="1.5" strokeLinecap="round" />
          {on && (
            <path d="M138 53 Q136 47 140 43" fill="none" stroke="rgba(255,255,255,0.15)" strokeWidth="0.8">
              <animate attributeName="d" values="M138 53 Q136 47 140 43;M138 53 Q140 45 137 40;M138 53 Q136 47 140 43" dur="2.5s" repeatCount="indefinite" />
            </path>
          )}
        </g>
      )}

      {/* Teacup + saucer — Codex. Shallower/wider; the saucer is the glance cue. */}
      {vessel === "cup" && (
        <g>
          <ellipse cx="140" cy="63.1" rx="8.2" ry="3.5" fill={mugSide} />
          <ellipse cx="140" cy="62.4" rx="8.2" ry="3.5" fill={mugBody} />
          <ellipse cx="140" cy="62.4" rx="5" ry="2.1" fill={mugSide} opacity="0.55" />
          <path d="M134.5 57.2 Q135 61.2 140 62 Q145 61.2 145.5 57.2 Z" fill={mugBody} />
          <path d="M134.5 57.2 Q135 61.2 140 62 Q137.2 59.9 137 57.2 Z" fill={mugSide} />
          <ellipse cx="140" cy="57.2" rx="5.5" ry="2.5" fill={mugRim} />
          <ellipse cx="140" cy="57.5" rx="4.2" ry="1.8" fill={cupLiquid} />
          <path d="M145.4 58.4 Q149.2 58.4 149.2 60.1 Q149.2 61.6 145.6 61.2" fill="none" stroke={mugSide} strokeWidth="1.2" strokeLinecap="round" />
          {on && (
            <path d="M138.6 55.2 Q136.6 49.4 140.4 45.6" fill="none" stroke="rgba(255,255,255,0.15)" strokeWidth="0.8">
              <animate attributeName="d" values="M138.6 55.2 Q136.6 49.4 140.4 45.6;M138.6 55.2 Q140.6 47.6 137.8 42.8;M138.6 55.2 Q136.6 49.4 140.4 45.6" dur="2.5s" repeatCount="indefinite" />
            </path>
          )}
        </g>
      )}

      {/* Small flask/bottle — OpenCode. Narrow neck + stopper is the glance cue. */}
      {vessel === "flask" && (
        <g>
          <ellipse cx="140" cy="63" rx="5.5" ry="2.4" fill={mugSide} />
          <path d="M136 58 L136 62.5 Q140 64 144 62.5 L144 58 Z" fill={mugBody} />
          <path d="M136 58 L136 62.5 Q138.5 63.2 140 63.2 L138 58 Z" fill={mugSide} />
          <path d="M137.5 54 L137.5 58 L142.5 58 L142.5 54 Z" fill={mugRim} />
          <path d="M137.5 54 L137.5 58 L139 58 L139 54 Z" fill={mugSide} />
          <ellipse cx="140" cy="54" rx="2.5" ry="1.1" fill={mugRim} />
          <rect x="138.2" y="51.2" width="3.6" height="2.8" rx="0.6" fill={mugSide} />
          <ellipse cx="140" cy="59.5" rx="3.2" ry="1.4" fill={flaskLiquid} opacity="0.85" />
          {on && (
            <path d="M139 51 Q137.5 46 140 43" fill="none" stroke="rgba(255,255,255,0.15)" strokeWidth="0.7">
              <animate attributeName="d" values="M139 51 Q137.5 46 140 43;M139 51 Q141 45 138.5 41;M139 51 Q137.5 46 140 43" dur="2.5s" repeatCount="indefinite" />
            </path>
          )}
        </g>
      )}

      {/* Small plant — terracotta pot, varies by desk */}
      {hasPlant && (
        <g transform="translate(35, 54)">
          <rect x="-3" y="0" width="6" height="7" rx="1" fill="#C4634F" />
          <ellipse cx="0" cy="0" rx="4" ry="1.5" fill="#D4735F" />
          {leaves.map(([d, stroke, width], i) => (
            <path key={i} d={d} stroke={stroke} fill="none" strokeWidth={width} />
          ))}
        </g>
      )}

      <DeskModelItem modelFamily={modelFamily} deskIndex={deskIndex} />

      {/* Desk lamp — south corner */}
      <g transform="translate(72, 78)">
        {/* Light pool on desk surface (dark mode only) */}
        <ellipse cx="0" cy="2" rx="22" ry="12" fill={`url(#${lampId})`} className="lamp-glow" />
        {/* Base — small iso diamond */}
        <path d="M-4 4 L0 2 L4 4 L0 6 Z" fill="#2a2a2a" />
        {/* Arm — straight up */}
        <line x1="0" y1="3" x2="0" y2="-12" stroke="#333" strokeWidth="1.5" strokeLinecap="round" />
        {/* Shade — small cone/trapezoid */}
        <path d="M-5 -10 L5 -10 L3 -14 L-3 -14 Z" fill="#C8A050" />
        <path d="M-5 -10 L-3 -14 L-3 -12 L-5 -9 Z" fill="#B08830" />
        {/* Bulb glow under shade (dark mode only) */}
        <ellipse cx="0" cy="-9" rx="3" ry="1.5" fill="#F5D090" opacity="0.6" className="lamp-glow" />
      </g>
    </svg>
  );
}
