import { useI18n } from "../i18n.tsx";
export function ScrollToBottomButton({ onClick }: { onClick: () => void }) {
  const { t } = useI18n();
  return (
    <button
      onClick={onClick}
      style={{
        position: "absolute",
        bottom: 80,
        right: 32,
        width: 36,
        height: 36,
        borderRadius: "50%",
        border: "1px solid var(--border-medium)",
        background: "var(--bg-surface)",
        color: "var(--text-muted)",
        fontSize: 16,
        cursor: "pointer",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        boxShadow: "0 2px 8px rgba(0,0,0,0.3)",
        zIndex: 5,
        transition: "opacity 0.15s",
      }}
      aria-label={t("chat.scrollBottom")}
      title={t("chat.scrollBottom")}
    >
      ↓
    </button>
  );
}
