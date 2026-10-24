import { useI18n } from "../../i18n.tsx";

export function ModelRecovery({ model, onClick }: { model?: string | null; onClick: () => void }) {
  const { t } = useI18n();
  const label = model ? t("chat.model.unavailable", { model }) : t("chat.model.choose");
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      onClick={onClick}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 5,
        padding: model ? 3 : "4px 8px",
        color: "var(--text-primary)",
        background: "var(--bg-secondary)",
        border: "1px solid var(--border)",
        borderRadius: 4,
        cursor: "pointer",
        fontSize: 12,
      }}
    >
      {model ? (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
          <path d="M12 3 2 21h20L12 3Z" />
          <path d="M12 9v5m0 3v1" />
        </svg>
      ) : (
        label
      )}
    </button>
  );
}
