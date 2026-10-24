import { useI18n } from "../i18n.tsx";
// Deleting an app frees its name and its port, so it is confirmed. Its data
// directory is set aside rather than removed, and the copy says so — that is the
// one thing a human wants to know before pressing this.

import { appBtnStyle } from "./styles.ts";

export function AppDeleteDialog({ name, busy, onCancel, onConfirm }: { name: string; busy: boolean; onCancel: () => void; onConfirm: () => void }) {
  const { t } = useI18n();
  return (
    <div
      onClick={onCancel}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.5)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 16,
        zIndex: 1000,
      }}
    >
      <div onClick={(e) => e.stopPropagation()} style={{ background: "var(--bg-base)", border: "1px solid var(--border)", borderRadius: 10, padding: 18, maxWidth: 420, width: "100%" }}>
        <div style={{ fontSize: 13, lineHeight: 1.5 }}>{t("apps.confirmDelete", { name })}</div>
        <div style={{ marginTop: 16, display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <button onClick={onCancel} style={appBtnStyle(false, false)}>
            {t("common.cancel")}
          </button>
          <button disabled={busy} onClick={onConfirm} style={appBtnStyle(true, busy)}>
            {t("common.delete")}
          </button>
        </div>
      </div>
    </div>
  );
}
