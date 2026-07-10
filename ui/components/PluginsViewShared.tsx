export const ACTION_BTN: React.CSSProperties = {
  padding: "3px 10px",
  borderRadius: 6,
  border: "1px solid var(--border)",
  background: "transparent",
  color: "var(--text-dim)",
  fontSize: 11,
  cursor: "pointer",
  whiteSpace: "nowrap",
};

export function thStyle(isMobile: boolean): React.CSSProperties {
  return {
    padding: isMobile ? "8px 6px" : "10px 12px",
    fontSize: 10,
    fontWeight: 700,
    color: "var(--text-muted)",
    fontFamily: "'JetBrains Mono',monospace",
    letterSpacing: "0.05em",
    textAlign: "left",
    whiteSpace: "nowrap",
    borderBottom: "1px solid var(--border-subtle)",
  };
}

export function tdStyle(isMobile: boolean): React.CSSProperties {
  return {
    padding: isMobile ? "8px 6px" : "10px 12px",
    fontSize: 12,
    borderBottom: "1px solid var(--border-subtle)",
    verticalAlign: "top",
  };
}

export function NameCell({ name, description, sub }: { name: string; description?: string; sub?: string }) {
  return (
    <div>
      <div style={{ fontWeight: 600, fontFamily: "'JetBrains Mono',monospace", fontSize: 12 }}>
        {name}
        {sub && <span style={{ fontWeight: 400, color: "var(--text-muted)", marginLeft: 8, fontSize: 11 }}>{sub}</span>}
      </div>
      {description && <div style={{ color: "var(--text-muted)", fontSize: 11, marginTop: 3, lineHeight: 1.4, maxWidth: 520 }}>{description}</div>}
    </div>
  );
}

// Installed plugins activate in new agent sessions only — the SDK subprocess
// reads the plugin dirs at spawn. Surfaced after install/enable so users
// aren't left wondering why a running agent doesn't see the new skills.
export const SESSION_NOTE = "Running agents pick this up on their next session (restart or /resume them).";
