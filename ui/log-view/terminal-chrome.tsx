export function TerminalHeader({ mobile, onClose, onInterrupt, onRestart }: { mobile: boolean; onClose: () => void; onInterrupt?: () => void; onRestart?: () => void }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "0 12px",
        height: mobile ? 44 : 36,
        borderBottom: "1px solid var(--border-strong)",
        background: "var(--bg-surface)",
        flexShrink: 0,
      }}
    >
      <span
        style={{
          fontSize: mobile ? 13 : 11,
          color: "var(--text-dim)",
          display: "flex",
          alignItems: "center",
          gap: 6,
        }}
      >
        {!mobile && <span style={{ color: "var(--green)", fontSize: 13 }}>&#9654;</span>}
        Terminal
      </span>
      <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
        <button
          onClick={onInterrupt}
          style={{
            padding: "3px 7px",
            borderRadius: 5,
            border: "1px solid var(--border-medium)",
            background: "var(--bg-overlay)",
            color: "var(--text-secondary)",
            fontSize: mobile ? 11 : 10,
            cursor: "pointer",
          }}
          title="Interrupt the foreground command"
        >
          Interrupt
        </button>
        <button
          onClick={onRestart}
          style={{
            padding: "3px 7px",
            borderRadius: 5,
            border: "1px solid var(--border-medium)",
            background: "var(--bg-overlay)",
            color: "var(--text-secondary)",
            fontSize: mobile ? 11 : 10,
            cursor: "pointer",
          }}
          title="Restart terminal"
        >
          Restart
        </button>
        <button
          onClick={onClose}
          style={{
            background: "none",
            border: "none",
            color: "var(--text-muted)",
            cursor: "pointer",
            fontSize: mobile ? 24 : 16,
            padding: mobile ? "4px 10px" : "0 4px",
            lineHeight: 1,
          }}
          title="Close terminal"
        >
          &times;
        </button>
      </div>
    </div>
  );
}

export function TerminalExitOverlay({ exitCode, onRestart }: { exitCode: number; onRestart: () => void }) {
  return (
    <div
      style={{
        position: "absolute",
        bottom: 16,
        left: "50%",
        transform: "translateX(-50%)",
        background: "var(--bg-overlay)",
        border: "1px solid var(--border-medium)",
        borderRadius: 8,
        padding: "8px 16px",
        display: "flex",
        alignItems: "center",
        gap: 12,
        fontSize: 12,
        color: "var(--text-dim)",
        boxShadow: "0 4px 12px var(--shadow)",
      }}
    >
      <span>Shell exited ({exitCode})</span>
      <button
        onClick={(e) => {
          e.stopPropagation();
          onRestart();
        }}
        style={{
          padding: "3px 12px",
          borderRadius: 6,
          border: "1px solid var(--green-border)",
          background: "var(--green-bg)",
          color: "var(--green)",
          fontSize: 12,
          cursor: "pointer",
        }}
      >
        Restart
      </button>
    </div>
  );
}
