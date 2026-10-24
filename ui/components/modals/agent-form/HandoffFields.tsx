import { useI18n } from "../../../i18n.tsx";
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
  const { t, language } = useI18n();
  return (
    <div style={{ marginTop: 14 }}>
      <label style={{ ...labelStyle, display: "block" }}>
        <input type="checkbox" checked={enabled} onChange={(event) => onEnabled(event.target.checked)} /> {t("agentSettings.handoff")}
      </label>
      <label style={{ ...labelStyle, display: "block", marginTop: 6 }}>
        {t("agentSettings.handoffLimit")}
        <input
          aria-label={t("agentSettings.handoffTokenLimit")}
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
        {t("agentSettings.handoffHint", { min: MIN_HANDOFF_TOKENS.toLocaleString(language), max: MAX_HANDOFF_TOKENS.toLocaleString(language) })}
      </p>
    </div>
  );
}
