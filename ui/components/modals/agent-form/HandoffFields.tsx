import type { CSSProperties } from "react";
import { MIN_HANDOFF_TOKENS, MAX_HANDOFF_TOKENS } from "../../../../shared/agents/handoff.ts";

export function HandoffFields({
  enabled,
  tokens,
  onEnabled,
  onTokens,
  labelStyle,
  inputStyle,
}: {
  enabled: boolean;
  tokens: string;
  onEnabled(value: boolean): void;
  onTokens(value: string): void;
  labelStyle: CSSProperties;
  inputStyle: CSSProperties;
}) {
  return (
    <div style={{ marginTop: 14 }}>
      <label style={{ ...labelStyle, display: "block" }}>
        <input type="checkbox" checked={enabled} onChange={(event) => onEnabled(event.target.checked)} /> Automatic handoff
      </label>
      <label style={{ ...labelStyle, display: "block", marginTop: 6 }}>
        Token limit
        <input
          aria-label="Automatic handoff token limit"
          type="number"
          min={MIN_HANDOFF_TOKENS}
          max={MAX_HANDOFF_TOKENS}
          step={1}
          value={tokens}
          disabled={!enabled}
          onChange={(event) => onTokens(event.target.value)}
          style={inputStyle}
        />
      </label>
      <p style={{ fontSize: 11, color: "var(--text-secondary)", margin: "6px 0 0" }}>
        Hand off at this limit or 85% context, whichever comes first (earlier when needed before engine compaction). Choose 50,000–10,000,000 tokens. Bureau writes a brief and preserves queued
        messages.
      </p>
    </div>
  );
}
