import { useI18n } from "../i18n.tsx";

export function OfficeHints({ isMobile }: { isMobile: boolean }) {
  const { t } = useI18n();
  const hints = isMobile ? [t("office.hints.tap"), t("office.hints.longPress")] : [t("office.hints.click"), t("office.hints.dragSwap"), t("office.hints.rightClick"), t("office.hints.esc")];
  return (
    <div
      style={{
        padding: isMobile ? "8px 12px" : "8px 20px",
        ...(isMobile ? { paddingBottom: "calc(8px + env(safe-area-inset-bottom, 0px))" } : {}),
        background: "var(--bg-hud-bottom)",
        backdropFilter: "blur(8px)",
        borderTop: "1px solid var(--border-subtle)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        gap: isMobile ? 12 : 20,
        flexShrink: 0,
        zIndex: 500,
      }}
    >
      {hints.map((h, i) => (
        <span
          key={i}
          style={{
            fontSize: 9,
            color: "var(--text-hint)",
            fontFamily: "'JetBrains Mono',monospace",
            letterSpacing: "0.04em",
          }}
        >
          {h}
        </span>
      ))}
    </div>
  );
}
