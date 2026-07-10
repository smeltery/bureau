export function VoiceInputControl({
  isListening,
  startListening,
  stopListening,
  showMicHint,
  setShowMicHint,
  speechApiPresent,
  isSecureContext,
}: {
  isListening: boolean;
  startListening: () => void;
  stopListening: () => void;
  showMicHint: boolean;
  setShowMicHint: (v: boolean | ((prev: boolean) => boolean)) => void;
  speechApiPresent: boolean;
  isSecureContext: boolean;
}) {
  if (speechApiPresent && isSecureContext) {
    return (
      <button
        onMouseDown={startListening}
        onMouseUp={stopListening}
        onMouseLeave={stopListening}
        onTouchStart={startListening}
        onTouchEnd={stopListening}
        style={{
          flexShrink: 0,
          width: 36,
          height: 36,
          marginTop: -9,
          borderRadius: 6,
          border: isListening ? "1px solid var(--red)" : "1px solid var(--border)",
          background: isListening ? "rgba(255,50,50,0.15)" : "transparent",
          color: isListening ? "var(--red)" : "var(--text-muted)",
          cursor: "pointer",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: 0,
          transition: "all 0.15s",
          animation: isListening ? "mic-pulse 1.5s ease-in-out infinite" : "none",
          userSelect: "none",
          WebkitUserSelect: "none",
        }}
        title="Hold to talk (Ctrl+Space)"
      >
        <MicIcon />
      </button>
    );
  }

  if (speechApiPresent && !isSecureContext) {
    return (
      <div style={{ position: "relative", flexShrink: 0 }}>
        <button
          onClick={() => setShowMicHint((v) => !v)}
          style={{
            width: 36,
            height: 36,
            marginTop: -9,
            borderRadius: 6,
            border: "1px solid var(--border)",
            background: "transparent",
            color: "var(--text-muted)",
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 0,
            opacity: 0.4,
          }}
          title="Voice input requires HTTPS"
        >
          <MicIcon />
        </button>
        {showMicHint && <MicHint onClose={() => setShowMicHint(false)} />}
      </div>
    );
  }

  return null;
}

function MicIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <rect x="9" y="1" width="6" height="12" rx="3" />
      <path d="M5 10a7 7 0 0 0 14 0" />
      <line x1="12" y1="17" x2="12" y2="23" />
      <line x1="8" y1="23" x2="16" y2="23" />
    </svg>
  );
}

function MicHint({ onClose }: { onClose: () => void }) {
  return (
    <div
      style={{
        position: "absolute",
        bottom: "calc(100% + 8px)",
        right: 0,
        width: 320,
        background: "var(--bg-surface)",
        border: "1px solid var(--border-medium)",
        borderRadius: 8,
        padding: "12px 14px",
        fontSize: 12,
        color: "var(--text-secondary)",
        boxShadow: "0 4px 16px rgba(0,0,0,0.4)",
        zIndex: 20,
        animation: "fadeIn 0.1s ease-out",
      }}
    >
      <div style={{ fontWeight: 600, marginBottom: 8, color: "var(--text-primary)" }}>Voice input requires HTTPS</div>
      <div style={{ marginBottom: 8, lineHeight: 1.5 }}>
        Enable HTTPS in your <span style={{ color: "var(--text-primary)" }}>Tailscale admin console</span> (DNS page), then run these on the host (use the built-in terminal):
      </div>
      <code
        style={{
          display: "block",
          background: "var(--bg-base)",
          border: "1px solid var(--border)",
          borderRadius: 4,
          padding: "8px 10px",
          fontSize: 11,
          fontFamily: "'JetBrains Mono',monospace",
          color: "var(--text-secondary)",
          whiteSpace: "pre-wrap",
          wordBreak: "break-all",
          lineHeight: 1.6,
        }}
      >
        {`sudo tailscale set --operator=$USER\ntailscale serve --bg http://localhost:${typeof window !== "undefined" ? window.location.port || "4000" : "4000"}`}
      </code>
      <div style={{ marginTop: 8, lineHeight: 1.5, color: "var(--text-muted)" }}>Restart bureau and reload this page. You'll be auto-redirected to HTTPS.</div>
      <button
        onClick={onClose}
        style={{
          position: "absolute",
          top: 8,
          right: 10,
          background: "none",
          border: "none",
          color: "var(--text-ghost)",
          cursor: "pointer",
          fontSize: 14,
          padding: 0,
        }}
      >
        &times;
      </button>
    </div>
  );
}
