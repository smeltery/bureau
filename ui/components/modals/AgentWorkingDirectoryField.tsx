export function AgentWorkingDirectoryField({
  cwd,
  cwdError,
  inputStyle,
  labelStyle,
  recentCwds,
  setCwd,
  setCwdError,
  showNextConversationHint,
}: {
  cwd: string;
  cwdError: string | null;
  inputStyle: React.CSSProperties;
  labelStyle: React.CSSProperties;
  recentCwds: string[];
  setCwd: (cwd: string) => void;
  setCwdError: (error: string | null) => void;
  showNextConversationHint: boolean;
}) {
  return (
    <>
      <label style={{ ...labelStyle, marginTop: 12 }}>Working Directory</label>
      <input
        value={cwd}
        onChange={(e) => {
          setCwd(e.target.value);
          if (cwdError) setCwdError(null);
        }}
        style={cwdError ? { ...inputStyle, borderColor: "#ff6b6b" } : inputStyle}
      />
      {cwdError && <p style={{ fontSize: 10, color: "#ff6b6b", margin: "4px 0 0" }}>{cwdError}</p>}
      {recentCwds.length > 0 && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginTop: 6 }}>
          {recentCwds.map((c) => (
            <button
              key={c}
              onClick={() => {
                setCwd(c);
                if (cwdError) setCwdError(null);
              }}
              style={chipStyle}
            >
              {c.replace(/^\/home\/[^/]+/, "~")}
            </button>
          ))}
        </div>
      )}
      {showNextConversationHint && <p style={{ fontSize: 10, color: "var(--text-ghost)", margin: "3px 0 0" }}>Changes take effect on next conversation.</p>}
    </>
  );
}

const chipStyle: React.CSSProperties = {
  background: "var(--bg-input)",
  border: "1px solid var(--border)",
  color: "var(--text-muted)",
  borderRadius: 4,
  padding: "2px 6px",
  fontSize: 10,
  cursor: "pointer",
};
