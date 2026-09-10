import type { AgentState, AgentOutfit } from "../../../shared/types.ts";
import { costumeOf } from "../../../shared/outfit-options.ts";
import { Accessory, Beard, Hair, Hat } from "./CharacterParts.tsx";
import { COSTUME_COLORS, CostumeBody, CostumeHead } from "./Costume.tsx";

// Map our states to visual poses
function visualState(state: AgentState): "working" | "waiting_for_response" | "error" | "idle" {
  switch (state) {
    case "thinking":
    case "tool_executing":
      return "working";
    case "waiting_for_response":
      return "waiting_for_response";
    case "error":
      return "error";
    default:
      return "idle";
  }
}

export function Character({ state, outfit }: { state: AgentState; outfit: AgentOutfit }) {
  const skin = outfit.skin ?? "#FFD5B8";
  const costume = costumeOf(outfit.costume);
  const bc = COSTUME_COLORS[costume] ?? outfit.color;
  const hair = outfit.hair;
  const hairStyle = outfit.hairStyle ?? "short";
  const beard = outfit.beard ?? "none";
  const vs = visualState(state);

  const wrap = (children: React.ReactNode, anim?: React.CSSProperties) => (
    <svg width="52" height="68" viewBox="0 0 52 68" overflow="visible" style={{ filter: "drop-shadow(0 3px 4px rgba(0,0,0,0.35))", ...anim }}>
      {children}
    </svg>
  );

  if (vs === "idle") {
    const hCx = 26,
      hCy = 37;
    return wrap(
      <>
        <ellipse cx={hCx} cy={50} rx={11} ry={10} fill={bc} />
        <CostumeBody costume={costume} seated={true} />
        <ellipse cx={hCx} cy={hCy} rx={10} ry={9} fill={skin} />
        <Hair style={hairStyle} color={hair} headCx={hCx} headCy={hCy} />
        <Hat type={outfit.hat} color={bc} headCx={hCx} headCy={hCy} />
        <CostumeHead costume={costume} headCx={hCx} headCy={hCy} />
        <Accessory type={outfit.accessory} headCx={hCx} headCy={hCy} />
        {/* Closed eyes */}
        <line x1={hCx - 6} y1={hCy + 1} x2={hCx - 2} y2={hCy + 1} stroke="#333" strokeWidth={1} strokeLinecap="round" />
        <line x1={hCx + 2} y1={hCy + 1} x2={hCx + 6} y2={hCy + 1} stroke="#333" strokeWidth={1} strokeLinecap="round" />
        <Beard type={beard} color={hair} headCx={hCx} headCy={hCy} />
        <g>
          <text x="36" y="28" fontSize="14" fill="rgba(200,220,255,0.7)" fontFamily="monospace" fontWeight="bold">
            <animate attributeName="y" values="28;22;28" dur="2s" repeatCount="indefinite" />
            <animate attributeName="opacity" values="0.5;0.9;0.5" dur="2s" repeatCount="indefinite" />z
          </text>
          <text x="44" y="18" fontSize="12" fill="rgba(200,220,255,0.6)" fontFamily="monospace" fontWeight="bold">
            <animate attributeName="y" values="18;12;18" dur="2.5s" repeatCount="indefinite" />
            <animate attributeName="opacity" values="0.4;0.8;0.4" dur="2.5s" repeatCount="indefinite" />z
          </text>
          <text x="50" y="10" fontSize="10" fill="rgba(200,220,255,0.5)" fontFamily="monospace" fontWeight="bold">
            <animate attributeName="y" values="10;4;10" dur="3s" repeatCount="indefinite" />
            <animate attributeName="opacity" values="0.3;0.7;0.3" dur="3s" repeatCount="indefinite" />z
          </text>
        </g>
      </>,
    );
  }

  if (vs === "error") {
    const hCx = 26,
      hCy = 25;
    return wrap(
      <>
        <rect x={16} y={36} width={20} height={16} fill={bc} rx={3} />
        <CostumeBody costume={costume} seated={false} />
        <rect x={5} y={28} width={7} height={4} fill={skin} rx={2} transform="rotate(-25 8 30)" />
        <rect x={40} y={28} width={7} height={4} fill={skin} rx={2} transform="rotate(25 43 30)" />
        <ellipse cx={hCx} cy={hCy} rx={10} ry={10} fill={skin} />
        <Hair style={hairStyle} color={hair} headCx={hCx} headCy={hCy} />
        <Hat type={outfit.hat} color={bc} headCx={hCx} headCy={hCy} />
        <CostumeHead costume={costume} headCx={hCx} headCy={hCy} />
        <g stroke="#c33" strokeWidth={1.5} strokeLinecap="round">
          <line x1={hCx - 6} y1={hCy - 3} x2={hCx - 3} y2={hCy + 1} />
          <line x1={hCx - 3} y1={hCy - 3} x2={hCx - 6} y2={hCy + 1} />
          <line x1={hCx + 3} y1={hCy - 3} x2={hCx + 6} y2={hCy + 1} />
          <line x1={hCx + 6} y1={hCy - 3} x2={hCx + 3} y2={hCy + 1} />
        </g>
        <path d={`M${hCx - 4} ${hCy + 6} Q${hCx - 2} ${hCy + 4} ${hCx} ${hCy + 6} Q${hCx + 2} ${hCy + 8} ${hCx + 4} ${hCy + 6}`} stroke="#c33" fill="none" strokeWidth={0.8} />
        <Beard type={beard} color={hair} headCx={hCx} headCy={hCy} />
        <g>
          <circle cx={42} cy={10} r={8} fill="#E85D75">
            <animate attributeName="r" values="8;9;8" dur="1s" repeatCount="indefinite" />
          </circle>
          <text x={39} y={14} fontSize={11} fill="white" fontWeight="bold">
            !
          </text>
        </g>
        <rect x={18} y={52} width={6} height={10} fill="#444" rx={2} />
        <rect x={28} y={52} width={6} height={10} fill="#444" rx={2} />
      </>,
      { animation: "errShake 0.4s ease-in-out infinite" },
    );
  }

  if (vs === "waiting_for_response") {
    const hCx = 26,
      hCy = 25;
    return wrap(
      <>
        <rect x={16} y={36} width={20} height={16} fill={bc} rx={3} />
        <CostumeBody costume={costume} seated={false} />
        <g>
          <rect x={38} y={20} width={7} height={10} fill={skin} rx={2} transform="rotate(-5 41 25)">
            <animate attributeName="transform" values="rotate(-5 41 25);rotate(12 41 25);rotate(-5 41 25)" dur="0.8s" repeatCount="indefinite" />
          </rect>
          <circle cx={41} cy={17} r={5.5} fill={skin}>
            <animate attributeName="cy" values="17;15;17" dur="0.8s" repeatCount="indefinite" />
          </circle>
        </g>
        <rect x={7} y={40} width={7} height={4} fill={skin} rx={2} />
        <ellipse cx={hCx} cy={hCy} rx={10} ry={10} fill={skin} />
        <Hair style={hairStyle} color={hair} headCx={hCx} headCy={hCy} />
        <Hat type={outfit.hat} color={bc} headCx={hCx} headCy={hCy} />
        <CostumeHead costume={costume} headCx={hCx} headCy={hCy} />
        <Accessory type={outfit.accessory} headCx={hCx} headCy={hCy} />
        <circle cx={hCx - 4} cy={hCy + 1} r={1.8} fill="#333" />
        <circle cx={hCx + 4} cy={hCy + 1} r={1.8} fill="#333" />
        <circle cx={hCx - 3.5} cy={hCy + 0.5} r={0.6} fill="white" />
        <circle cx={hCx + 4.5} cy={hCy + 0.5} r={0.6} fill="white" />
        <path d={`M${hCx - 3} ${hCy + 5} Q${hCx} ${hCy + 7} ${hCx + 3} ${hCy + 5}`} stroke="#333" fill="none" strokeWidth={0.8} />
        <Beard type={beard} color={hair} headCx={hCx} headCy={hCy} />
        <rect x={18} y={52} width={6} height={10} fill="#444" rx={2} />
        <rect x={28} y={52} width={6} height={10} fill="#444" rx={2} />
      </>,
      { animation: "waitBounce 2s ease-in-out infinite" },
    );
  }

  // working / starting
  const hCx = 26,
    hCy = 25;
  return wrap(
    <>
      <rect x={16} y={36} width={20} height={16} fill={bc} rx={3} />
      <CostumeBody costume={costume} seated={false} />
      <g>
        <rect x={7} y={42} width={8} height={4} fill={skin} rx={2}>
          <animate attributeName="y" values="42;41;42" dur="0.3s" repeatCount="indefinite" />
        </rect>
        <rect x={37} y={42} width={8} height={4} fill={skin} rx={2}>
          <animate attributeName="y" values="42;43;42" dur="0.3s" repeatCount="indefinite" />
        </rect>
      </g>
      <ellipse cx={hCx} cy={hCy} rx={10} ry={10} fill={skin} />
      <Hair style={hairStyle} color={hair} headCx={hCx} headCy={hCy} />
      <Hat type={outfit.hat} color={bc} headCx={hCx} headCy={hCy} />
      <CostumeHead costume={costume} headCx={hCx} headCy={hCy} />
      <Accessory type={outfit.accessory} headCx={hCx} headCy={hCy} />
      <circle cx={hCx - 4} cy={hCy + 1} r={1.5} fill="#333" />
      <circle cx={hCx + 4} cy={hCy + 1} r={1.5} fill="#333" />
      <Beard type={beard} color={hair} headCx={hCx} headCy={hCy} />
      <rect x={18} y={52} width={6} height={10} fill="#444" rx={2} />
      <rect x={28} y={52} width={6} height={10} fill="#444" rx={2} />
    </>,
  );
}
