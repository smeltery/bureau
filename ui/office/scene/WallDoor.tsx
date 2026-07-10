export interface DoorProps {
  label: string;
  onClick: () => void;
  dragOver?: boolean;
  reject?: boolean;
}

export function WallDoor({ door, side }: { door: DoorProps; side: "left" | "right" }) {
  const isLeft = side === "left";
  const transform = isLeft ? "translate(-315, 237) skewY(-27)" : "translate(555, 237) skewY(27)";
  const knobX = isLeft ? 15 : -15;
  const highlightX = isLeft ? 14.5 : -15.5;

  return (
    <g data-no-pan onClick={door.onClick} style={{ cursor: "pointer", pointerEvents: "auto" }}>
      <g transform={transform}>
        <rect x="-33" y="-93" width="66" height="113" rx="3" fill={door.reject ? "#5a2020" : door.dragOver ? "#5a4a2a" : "#3a2a1a"} stroke="#2a1a0a" strokeWidth="1.5" />
        <rect x="-27" y="-87" width="54" height="101" rx="1.5" fill={door.reject ? "#7a3030" : door.dragOver ? "#7a6050" : "#5a4030"} />
        <rect x="-21" y="-78" width="42" height="36" rx="1.5" fill={door.reject ? "#8a4040" : door.dragOver ? "#8a7060" : "#6a5040"} stroke="#4a3020" strokeWidth="0.5" />
        <rect x="-21" y="-31" width="42" height="36" rx="1.5" fill={door.reject ? "#8a4040" : door.dragOver ? "#8a7060" : "#6a5040"} stroke="#4a3020" strokeWidth="0.5" />
        <circle cx={knobX} cy="-25" r="5" fill="#8a7040" />
        <circle cx={knobX} cy="-25" r="3.5" fill="#c0a060" />
        <ellipse cx={highlightX} cy="-26" rx="2" ry="1.5" fill="#d8c080" opacity="0.6" />
        {door.dragOver && <rect x="-33" y="-93" width="66" height="113" rx="3" fill="rgba(126,184,255,0.15)" stroke="rgba(126,184,255,0.6)" strokeWidth="2" />}
        {door.reject && <rect x="-33" y="-93" width="66" height="113" rx="3" fill="rgba(255,60,60,0.25)" stroke="rgba(255,60,60,0.7)" strokeWidth="2" />}
        <text
          x="0"
          y="-98"
          textAnchor="middle"
          fill={door.reject ? "var(--red, #f85149)" : door.dragOver ? "var(--accent, #58a6ff)" : "var(--text-dim)"}
          fontSize="12"
          fontFamily="'JetBrains Mono',monospace"
          fontWeight="600"
          style={{ userSelect: "none" }}
        >
          {door.label}
        </text>
      </g>
    </g>
  );
}
