const STAR_UV: Array<[number, number, number]> = [
  [0.1, 0.2, 0.6],
  [0.3, 0.1, 0.9],
  [0.5, 0.3, 0.5],
  [0.8, 0.15, 0.7],
  [0.15, 0.5, 0.5],
  [0.4, 0.4, 0.8],
  [0.65, 0.2, 0.6],
  [0.9, 0.35, 0.5],
  [0.2, 0.75, 0.9],
  [0.45, 0.6, 0.6],
  [0.7, 0.5, 0.7],
  [0.85, 0.7, 0.5],
  [0.05, 0.9, 0.5],
  [0.35, 0.8, 0.7],
  [0.6, 0.75, 0.6],
  [0.95, 0.55, 0.8],
  [0.25, 0.35, 0.5],
  [0.55, 0.85, 0.6],
  [0.75, 0.4, 0.7],
  [0.1, 0.65, 0.5],
  [0.5, 0.15, 0.8],
  [0.7, 0.9, 0.5],
  [0.85, 0.1, 0.6],
  [0.3, 0.55, 0.5],
];

function projectWindowStars(): Array<[number, number, number]> {
  return STAR_UV.map(([u, v, r]) => {
    const topY = 25 + u * (-45 - 25);
    const botY = 115 + u * (45 - 115);
    const x = -285 + u * 140;
    const y = topY + v * (botY - topY);
    return [x, y, r];
  });
}

export function WallWindow({ now, onToggleTheme }: { now: Date; onToggleTheme?: () => void }) {
  const moonPhase = (now.getDate() / 30) * 2 - 1;
  const stars = projectWindowStars();

  return (
    <>
      <clipPath id="window-clip">
        <path d="M-285 115 L-145 45 L-145 -45 L-285 25 Z" />
      </clipPath>

      <path d="M-290 120 L-140 45 L-140 -50 L-290 25 Z" fill="var(--wall-decor)" stroke="var(--wall-stroke)" strokeWidth="1" />
      <path d="M-285 115 L-145 45 L-145 -45 L-285 25 Z" fill="#0a0e1a" />

      <g clipPath="url(#window-clip)" className="window-night">
        <path d="M-285 115 L-145 45 L-145 -45 L-285 25 Z" fill="#0a0e1a" />
        {stars.map(([sx, sy, sr], i) => (
          <circle key={i} cx={sx} cy={sy} r={sr} fill="white" opacity={0.4 + (i % 4) * 0.15}>
            {i % 5 === 0 && <animate attributeName="opacity" values={`${0.3 + (i % 3) * 0.1};${0.7 + (i % 2) * 0.2};${0.3 + (i % 3) * 0.1}`} dur={`${2 + (i % 3)}s`} repeatCount="indefinite" />}
          </circle>
        ))}
        <g data-no-pan onClick={onToggleTheme} style={{ cursor: "pointer", pointerEvents: "auto" }}>
          <circle cx={-203} cy={-8} r={18} fill="transparent" />
          <circle cx={-203} cy={-8} r={12} fill="#E8E0C8" />
          <circle cx={-203 + moonPhase * 10} cy={-9} r={10} fill="#0a0e1a" />
          <circle cx={-203} cy={-8} r={18} fill="#E8E0C8" opacity="0.05" />
        </g>
      </g>

      <g clipPath="url(#window-clip)" className="window-day">
        <path d="M-285 115 L-145 45 L-145 -45 L-285 25 Z" fill="#87CEEB" />
        <g data-no-pan onClick={onToggleTheme} style={{ cursor: "pointer", pointerEvents: "auto" }}>
          <circle cx={-205} cy={-5} r={20} fill="transparent" />
          <circle cx={-205} cy={-5} r={14} fill="#F5D060" />
          <circle cx={-205} cy={-5} r={20} fill="#F5D060" opacity="0.15" />
        </g>
        <ellipse cx={-240} cy={40} rx={18} ry={6} fill="white" opacity="0.7" />
        <ellipse cx={-230} cy={37} rx={12} ry={5} fill="white" opacity="0.6" />
        <ellipse cx={-175} cy={5} rx={14} ry={5} fill="white" opacity="0.5" />
        <ellipse cx={-165} cy={3} rx={10} ry={4} fill="white" opacity="0.45" />
      </g>

      <line x1={-215} y1={80} x2={-215} y2={-10} stroke="var(--wall-decor)" strokeWidth="2" />
      <path d="M-285 70 L-145 0" stroke="var(--wall-decor)" strokeWidth="2" fill="none" />
    </>
  );
}
