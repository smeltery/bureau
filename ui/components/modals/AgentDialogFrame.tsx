import { useEffect, type ReactNode } from "react";
import { dialogCancelBtn, dialogSaveBtn } from "./dialog-styles.ts";
import { shouldHostCloseOnEscape } from "./expandedEditorState.ts";
import { useI18n } from "../../i18n.tsx";

type AgentDialogFrameProps = {
  children: ReactNode;
  isMobile: boolean;
  isSpawn: boolean;
  onClose: () => void;
  onSave: () => void;
  saving: boolean;
  subtitle: string;
  title: string;
};

export function AgentDialogFrame({ children, isMobile, isSpawn, onClose, onSave, saving, subtitle, title }: AgentDialogFrameProps) {
  const { t } = useI18n();
  // Own Escape while the dialog is open (capture + stopPropagation), so it
  // routes through onClose's discard guard instead of App's global keydown
  // handler — which would drop the whole form, even mid-typing in a field.
  //
  // Unless an expanded editor (ExpandableTextarea) is open: it collapses on
  // Escape and this handler must stand down, or one Escape meant to collapse a
  // fullscreen memory/instructions editor would instead pop the discard confirm
  // for the entire form. Our capture listener was registered before the
  // overlay's, so it runs first and has to make that call itself.
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (!shouldHostCloseOnEscape(e)) return;
      e.stopPropagation();
      onClose();
    }
    window.addEventListener("keydown", handleKey, true);
    return () => window.removeEventListener("keydown", handleKey, true);
  }, [onClose]);

  return (
    <div
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 900,
        background: "rgba(0,0,0,0.55)",
        backdropFilter: "blur(10px)",
        display: "flex",
        alignItems: isMobile ? "stretch" : "center",
        justifyContent: "center",
        overflowY: "auto",
      }}
    >
      <div
        style={{
          background: "var(--bg-overlay)",
          backdropFilter: "blur(16px)",
          border: isMobile ? "none" : "1px solid var(--border-light)",
          borderRadius: isMobile ? 0 : 16,
          display: "flex",
          flexDirection: "column",
          width: isMobile ? "100%" : 380,
          maxWidth: isMobile ? "100%" : undefined,
          height: isMobile ? "100dvh" : undefined,
          maxHeight: isMobile ? "100dvh" : "90vh",
          boxShadow: isMobile ? "none" : "0 20px 60px var(--shadow-heavy)",
          animation: "hudIn 0.2s ease-out",
        }}
      >
        <div style={{ overflowY: "auto", flex: 1, padding: isMobile ? "max(24px, env(safe-area-inset-top)) 20px 16px" : "24px 28px 16px" }}>
          <h3 style={{ fontSize: 17, fontWeight: 700, margin: 0, color: "var(--text-primary)" }}>{title}</h3>
          <p style={{ fontSize: 12, color: "var(--text-faint)", margin: "2px 0 18px" }}>{subtitle}</p>
          {children}
        </div>
        <div
          style={{
            display: "flex",
            justifyContent: "flex-end",
            gap: 8,
            padding: isMobile ? "16px 20px max(24px, env(safe-area-inset-bottom))" : "20px 28px 22px",
            borderTop: "1px solid var(--border)",
            flexShrink: 0,
          }}
        >
          <button onClick={onClose} style={dialogCancelBtn} disabled={saving}>
            {t("common.cancel")}
          </button>
          <button onClick={onSave} style={dialogSaveBtn} disabled={saving}>
            {saving ? t("common.saving") : isSpawn ? t("dialogs.agent.spawn") : t("common.save")}
          </button>
        </div>
      </div>
    </div>
  );
}
