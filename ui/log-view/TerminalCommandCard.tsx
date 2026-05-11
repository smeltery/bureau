import { useCallback } from "react";
import type { TerminalCommandPayload } from "../../shared/types.ts";

export function TerminalCommandCard({ payload, onCopy }: { payload: TerminalCommandPayload; onCopy: (command: string) => void }) {
  const handleCopyClipboard = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(payload.command);
    } catch {
      const ta = document.createElement("textarea");
      ta.value = payload.command;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
    }
  }, [payload.command]);

  return (
    <div
      style={{
        margin: "8px 0",
        borderRadius: 10,
        background: "var(--bg-subtle)",
        border: "1px solid var(--border)",
        overflow: "hidden",
      }}
    >
      <div style={{ padding: "10px 12px", display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <span
          style={{
            fontFamily: "'JetBrains Mono',monospace",
            fontSize: 13,
            color: "var(--text-secondary)",
            whiteSpace: "pre-wrap",
            wordBreak: "break-all",
            flex: 1,
            minWidth: 0,
          }}
          title={payload.command}
        >
          <span style={{ color: "var(--text-ghost)", userSelect: "none" }}>$ </span>
          {payload.command}
        </span>
        <button
          onClick={handleCopyClipboard}
          title="Copy to clipboard"
          style={{
            padding: "4px 10px",
            borderRadius: 6,
            border: "1px solid var(--border-medium)",
            background: "var(--btn-surface)",
            color: "var(--text-dim)",
            fontSize: 12,
            fontFamily: "'JetBrains Mono',monospace",
            cursor: "pointer",
            flexShrink: 0,
          }}
        >
          Copy
        </button>
        <button
          onClick={() => onCopy(payload.command)}
          style={{
            padding: "4px 12px",
            borderRadius: 6,
            border: "1px solid var(--green-border)",
            background: "var(--green-bg)",
            color: "var(--green)",
            fontSize: 12,
            fontFamily: "'JetBrains Mono',monospace",
            cursor: "pointer",
            flexShrink: 0,
          }}
          title="Open the terminal panel and type this command at the prompt (not auto-executed)"
        >
          Copy to terminal
        </button>
      </div>
    </div>
  );
}
