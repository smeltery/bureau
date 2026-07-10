export function Corkboard({ taskCount, onOpenTasks }: { taskCount: number; onOpenTasks?: () => void }) {
  return (
    <g data-no-pan transform="translate(-55, -30) skewY(-27)" onClick={onOpenTasks} style={{ cursor: "pointer", pointerEvents: "auto" }}>
      <rect x="-50" y="-40" width="95" height="70" rx="2" fill="#5a4430" stroke="#4a3620" strokeWidth="1" />
      <rect x="-46" y="-36" width="87" height="62" rx="1" fill="#c49a6c" />
      <circle cx="-30" cy="-20" r="0.8" fill="#b88a58" opacity="0.5" />
      <circle cx="-10" cy="-10" r="0.6" fill="#b88a58" opacity="0.4" />
      <circle cx="15" cy="-25" r="0.7" fill="#b88a58" opacity="0.5" />
      <circle cx="25" cy="5" r="0.6" fill="#b88a58" opacity="0.4" />
      <circle cx="-35" cy="10" r="0.7" fill="#b88a58" opacity="0.3" />
      <circle cx="5" cy="15" r="0.5" fill="#b88a58" opacity="0.4" />

      <g transform="translate(-32, -22) rotate(-3)">
        <rect x="0" y="0" width="28" height="20" rx="1" fill="#f5f0e0" stroke="#e0d8c4" strokeWidth="0.3" />
        {taskCount >= 1 && (
          <>
            <line x1="3" y1="6" x2="25" y2="6" stroke="#ccc" strokeWidth="0.3" />
            <line x1="3" y1="10" x2="22" y2="10" stroke="#ccc" strokeWidth="0.3" />
            <line x1="3" y1="14" x2="18" y2="14" stroke="#ccc" strokeWidth="0.3" />
          </>
        )}
        <circle cx="14" cy="2" r="2.5" fill="#e04040" />
        <circle cx="14" cy="2" r="1.2" fill="#c03030" />
      </g>

      <g transform="translate(5, -18) rotate(2)">
        <rect x="0" y="0" width="30" height="22" rx="1" fill="#eef4ff" stroke="#d0d8e8" strokeWidth="0.3" />
        {taskCount >= 2 && (
          <>
            <line x1="3" y1="6" x2="27" y2="6" stroke="#bbc" strokeWidth="0.3" />
            <line x1="3" y1="10" x2="25" y2="10" stroke="#bbc" strokeWidth="0.3" />
            <line x1="3" y1="14" x2="20" y2="14" stroke="#bbc" strokeWidth="0.3" />
            <line x1="3" y1="18" x2="15" y2="18" stroke="#bbc" strokeWidth="0.3" />
          </>
        )}
        <circle cx="15" cy="2" r="2.5" fill="#4080d0" />
        <circle cx="15" cy="2" r="1.2" fill="#3060b0" />
      </g>

      <g transform="translate(-28, 4) rotate(1.5)">
        <rect x="0" y="0" width="26" height="18" rx="1" fill="#fff8e0" stroke="#e8dcc0" strokeWidth="0.3" />
        {taskCount >= 3 && (
          <>
            <line x1="3" y1="5" x2="23" y2="5" stroke="#dda" strokeWidth="0.3" />
            <line x1="3" y1="9" x2="20" y2="9" stroke="#dda" strokeWidth="0.3" />
            <line x1="3" y1="13" x2="16" y2="13" stroke="#dda" strokeWidth="0.3" />
          </>
        )}
        <circle cx="13" cy="1" r="2.5" fill="#e8c020" />
        <circle cx="13" cy="1" r="1.2" fill="#c8a010" />
      </g>

      <g transform="translate(18, 8)">
        <circle cx="0" cy="0" r="2.5" fill="#40b060" />
        <circle cx="0" cy="0" r="1.2" fill="#309048" />
        <circle cx="0" cy="3" r="0.8" fill="#a08050" opacity="0.3" />
      </g>
    </g>
  );
}

export function OfficePromptSign({ hasOfficePrompt, onWallPanelClick }: { hasOfficePrompt?: boolean; onWallPanelClick?: (x: number, y: number) => void }) {
  return (
    <g data-no-pan transform="translate(50, -75) skewY(-27)" onClick={(e) => onWallPanelClick?.(e.clientX, e.clientY)} style={{ cursor: "pointer", pointerEvents: "auto" }}>
      <rect x="-30" y="-32" width="60" height="58" rx="2" fill="#3a3028" stroke="#2a2018" strokeWidth="1.2" />
      <rect x="-27" y="-29" width="54" height="52" rx="1" fill="none" stroke="#8a7a60" strokeWidth="0.5" />
      <rect x="-25" y="-27" width="50" height="48" rx="1" fill={hasOfficePrompt ? "#f5f0e4" : "#ece8dc"} />
      <line x1="-14" y1="-20" x2="14" y2="-20" stroke="#333" strokeWidth="1" opacity="0.35" strokeLinecap="round" />
      {hasOfficePrompt ? (
        <>
          <line x1="-10" y1="-16" x2="10" y2="-16" stroke="#999" strokeWidth="0.3" opacity="0.3" />
          <line x1="-18" y1="-10" x2="18" y2="-10" stroke="#444" strokeWidth="0.6" opacity="0.25" />
          <line x1="-18" y1="-5" x2="16" y2="-5" stroke="#444" strokeWidth="0.6" opacity="0.25" />
          <line x1="-18" y1="0" x2="17" y2="0" stroke="#444" strokeWidth="0.6" opacity="0.25" />
          <line x1="-18" y1="5" x2="14" y2="5" stroke="#444" strokeWidth="0.6" opacity="0.25" />
          <line x1="-18" y1="10" x2="12" y2="10" stroke="#444" strokeWidth="0.6" opacity="0.25" />
          <circle cx="0" cy="17" r="4" fill="none" stroke="#8a6040" strokeWidth="0.5" opacity="0.2" />
          <circle cx="0" cy="17" r="2" fill="#8a6040" opacity="0.08" />
        </>
      ) : (
        <>
          <line x1="-8" y1="-4" x2="8" y2="-4" stroke="#bbb" strokeWidth="0.6" opacity="0.3" strokeLinecap="round" />
          <line x1="-6" y1="0" x2="6" y2="0" stroke="#bbb" strokeWidth="0.5" opacity="0.2" strokeLinecap="round" />
          <line x1="-4" y1="4" x2="4" y2="4" stroke="#bbb" strokeWidth="0.4" opacity="0.15" strokeLinecap="round" />
        </>
      )}
    </g>
  );
}
