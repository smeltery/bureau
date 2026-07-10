import type { AgentOutfit } from "../../../shared/types.ts";

export function Hair({ style, color, headCx, headCy }: { style: AgentOutfit["hairStyle"]; color: string; headCx: number; headCy: number }) {
  const topY = headCy - 6;
  switch (style) {
    case "long":
      return (
        <>
          <ellipse cx={headCx} cy={topY} rx={10} ry={5.5} fill={color} />
          <rect x={headCx - 12} y={topY - 1} width={5} height={16} rx={2.5} fill={color} />
          <rect x={headCx + 7} y={topY - 1} width={5} height={16} rx={2.5} fill={color} />
        </>
      );
    case "ponytail":
      return (
        <>
          <ellipse cx={headCx} cy={topY} rx={10} ry={5.5} fill={color} />
          <path d={`M${headCx + 8} ${topY} Q${headCx + 16} ${topY - 2} ${headCx + 14} ${topY + 10} Q${headCx + 13} ${topY + 16} ${headCx + 10} ${topY + 14}`} fill={color} />
          <circle cx={headCx + 10} cy={topY + 1} r={1.5} fill="#FF6B9D" />
        </>
      );
    case "bun":
      return (
        <>
          <ellipse cx={headCx} cy={topY} rx={10} ry={5.5} fill={color} />
          <circle cx={headCx} cy={topY - 4} r={5} fill={color} />
        </>
      );
    case "pigtails":
      return (
        <>
          <ellipse cx={headCx} cy={topY} rx={10} ry={5.5} fill={color} />
          <ellipse cx={headCx - 12} cy={topY + 5} rx={3} ry={6} fill={color} />
          <ellipse cx={headCx + 12} cy={topY + 5} rx={3} ry={6} fill={color} />
          <circle cx={headCx - 11} cy={topY + 1} r={1.5} fill="#FF6B9D" />
          <circle cx={headCx + 11} cy={topY + 1} r={1.5} fill="#FF6B9D" />
        </>
      );
    case "curly":
      return (
        <>
          <ellipse cx={headCx} cy={topY - 1} rx={12} ry={7} fill={color} />
          <circle cx={headCx - 10} cy={topY + 3} r={3.5} fill={color} />
          <circle cx={headCx + 10} cy={topY + 3} r={3.5} fill={color} />
          <circle cx={headCx - 6} cy={topY - 5} r={3} fill={color} />
          <circle cx={headCx + 6} cy={topY - 5} r={3} fill={color} />
        </>
      );
    case "bald":
      return null;
    default:
      return <ellipse cx={headCx} cy={topY} rx={10} ry={5.5} fill={color} />;
  }
}

export function Hat({ type, color, headCx, headCy }: { type: AgentOutfit["hat"]; color: string; headCx: number; headCy: number }) {
  const topY = headCy - 6;
  switch (type) {
    case "cap":
      return (
        <>
          <path d={`M${headCx - 13} ${topY + 2} Q${headCx} ${topY - 14} ${headCx + 13} ${topY + 2}`} fill={color} />
          <rect x={headCx - 15} y={topY + 1} width={27} height={3} fill={color} rx={1} />
        </>
      );
    case "beanie":
      return <ellipse cx={headCx} cy={topY - 2} rx={11} ry={6.5} fill={color} />;
    case "bow":
      return (
        <>
          <path d={`M${headCx - 2} ${topY - 3} Q${headCx - 8} ${topY - 9} ${headCx - 2} ${topY - 6}`} fill="#FF6B9D" />
          <path d={`M${headCx + 2} ${topY - 3} Q${headCx + 8} ${topY - 9} ${headCx + 2} ${topY - 6}`} fill="#FF6B9D" />
          <circle cx={headCx} cy={topY - 4.5} r={1.5} fill="#E84393" />
        </>
      );
    case "headband":
      return <path d={`M${headCx - 10} ${topY + 2} Q${headCx} ${topY - 2} ${headCx + 10} ${topY + 2}`} stroke="#FF8C42" strokeWidth={2.5} fill="none" strokeLinecap="round" />;
    default:
      return null;
  }
}

export function Beard({ type, color, headCx, headCy }: { type: AgentOutfit["beard"]; color: string; headCx: number; headCy: number }) {
  switch (type) {
    case "stubble":
      return (
        <g fill={color} opacity={0.7}>
          {[
            [-4, 6],
            [-1, 6],
            [2, 6],
            [5, 6],
            [-5, 8],
            [-2, 8],
            [1, 8],
            [4, 8],
            [-3, 10],
            [0, 10],
            [3, 10],
            [-1, 11],
            [1, 11],
          ].map(([dx, dy], i) => (
            <circle key={i} cx={headCx + dx} cy={headCy + dy} r={0.9} />
          ))}
        </g>
      );
    case "full":
      return <path d={`M${headCx - 6} ${headCy + 5} Q${headCx - 7} ${headCy + 11} ${headCx} ${headCy + 13} Q${headCx + 7} ${headCy + 11} ${headCx + 6} ${headCy + 5}`} fill={color} opacity={0.9} />;
    case "goatee":
      return <path d={`M${headCx - 4} ${headCy + 7} Q${headCx - 5} ${headCy + 11} ${headCx} ${headCy + 13} Q${headCx + 5} ${headCy + 11} ${headCx + 4} ${headCy + 7}`} fill={color} opacity={0.9} />;
    case "mustache":
      return (
        <path
          d={`M${headCx - 7} ${headCy + 7} Q${headCx - 4} ${headCy + 4} ${headCx} ${headCy + 5} Q${headCx + 4} ${headCy + 4} ${headCx + 7} ${headCy + 7} Q${headCx + 4} ${headCy + 6} ${headCx} ${headCy + 7} Q${headCx - 4} ${headCy + 6} ${headCx - 7} ${headCy + 7} Z`}
          fill={color}
          opacity={0.9}
        />
      );
    default:
      return null;
  }
}

export function Accessory({ type, headCx, headCy }: { type: AgentOutfit["accessory"]; headCx: number; headCy: number }) {
  switch (type) {
    case "glasses":
      return (
        <>
          <circle cx={headCx - 4} cy={headCy + 1} r={4} stroke="#666" fill="none" strokeWidth={0.8} />
          <circle cx={headCx + 4} cy={headCy + 1} r={4} stroke="#666" fill="none" strokeWidth={0.8} />
        </>
      );
    case "headphones":
      return (
        <>
          <path
            d={`M${headCx - 12} ${headCy - 4} Q${headCx - 12} ${headCy - 15} ${headCx} ${headCy - 15} Q${headCx + 12} ${headCy - 15} ${headCx + 12} ${headCy - 4}`}
            stroke="#555"
            fill="none"
            strokeWidth={3}
          />
          <rect x={headCx - 16} y={headCy - 6} width={8} height={10} rx={3} fill="#555" />
          <rect x={headCx + 8} y={headCy - 6} width={8} height={10} rx={3} fill="#555" />
        </>
      );
    case "bow_tie":
      return (
        <>
          <path d={`M${headCx - 1} ${headCy + 10} L${headCx - 5} ${headCy + 7} L${headCx - 5} ${headCy + 13} Z`} fill="#E85D75" />
          <path d={`M${headCx + 1} ${headCy + 10} L${headCx + 5} ${headCy + 7} L${headCx + 5} ${headCy + 13} Z`} fill="#E85D75" />
          <circle cx={headCx} cy={headCy + 10} r={1.5} fill="#c33" />
        </>
      );
    case "tie":
      return (
        <>
          <path d={`M${headCx - 2} ${headCy + 9} L${headCx} ${headCy + 11} L${headCx + 2} ${headCy + 9} Z`} fill="#2c3e50" />
          <path d={`M${headCx - 2} ${headCy + 11} L${headCx - 3} ${headCy + 22} L${headCx} ${headCy + 24} L${headCx + 3} ${headCy + 22} L${headCx + 2} ${headCy + 11} Z`} fill="#2c3e50" />
        </>
      );
    case "earrings":
      return (
        <>
          <circle cx={headCx - 10} cy={headCy + 4} r={2} fill="#FFD700" />
          <circle cx={headCx + 10} cy={headCy + 4} r={2} fill="#FFD700" />
        </>
      );
    default:
      return null;
  }
}
