import type { ChoicePromptPayload } from "../../../shared/types.ts";
import { displayLogText } from "../../../shared/i18n/log-message.ts";
import { useI18n } from "../../i18n.tsx";

export function ChoicePromptCard({ prompt, isMobile, onPick }: { prompt: ChoicePromptPayload; isMobile?: boolean; onPick?: (position: number) => void }) {
  const { language, t } = useI18n();
  return (
    <div
      style={{
        margin: "8px 0",
        padding: "10px 12px",
        borderRadius: 8,
        background: "var(--bg-subtle)",
        border: "1px solid var(--border-dim)",
        color: "var(--text-primary)",
        fontSize: isMobile ? 14 : 13,
      }}
    >
      <div style={{ fontWeight: 700, marginBottom: 8 }}>{displayLogText(prompt.title, prompt.titleMessage, language)}</div>
      <div style={{ display: "grid", gap: 6 }}>
        {prompt.choices.map((choice, index) => (
          <button
            key={`${choice.value}-${index}`}
            type="button"
            disabled={!onPick}
            onClick={() => onPick?.(index + 1)}
            style={{
              display: "grid",
              gridTemplateColumns: "2.5ch minmax(0, 1fr)",
              gap: 8,
              alignItems: "baseline",
              padding: "7px 8px",
              borderRadius: 6,
              background: choice.current ? "var(--bg-code)" : "var(--bg-base)",
              border: choice.current ? "1px solid var(--accent)" : "1px solid var(--border-dim)",
              color: "inherit",
              cursor: onPick ? "pointer" : "default",
              textAlign: "left",
            }}
          >
            <span style={{ fontVariantNumeric: "tabular-nums", color: "var(--text-muted)", textAlign: "right" }}>{index + 1}.</span>
            <span style={{ minWidth: 0 }}>
              <span style={{ fontWeight: 600, overflowWrap: "anywhere" }}>
                {displayLogText(choice.label, choice.labelMessage, language)}
                {choice.current ? t("logs.choice.current") : ""}
              </span>
              {choice.description && (
                <span style={{ display: "block", color: "var(--text-dim)", fontSize: isMobile ? 12 : 11, marginTop: 2, overflowWrap: "anywhere" }}>
                  {displayLogText(choice.description, choice.descriptionMessage, language)}
                </span>
              )}
            </span>
          </button>
        ))}
      </div>
      <div style={{ marginTop: 8, color: "var(--text-dim)", fontSize: isMobile ? 12 : 11 }}>{displayLogText(prompt.instruction, prompt.instructionMessage, language)}</div>
    </div>
  );
}
