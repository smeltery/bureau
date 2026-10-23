import { useI18n } from "../i18n.tsx";
import type { Tab } from "./editor-model.ts";

export function EditorFooter({ activeTab, mobile }: { activeTab: Tab | null; mobile: boolean }) {
  const { t } = useI18n();
  const shortcut = typeof navigator !== "undefined" && (navigator.platform || "").includes("Mac") ? "⌘S" : "Ctrl+S";
  if (!activeTab) return null;

  return (
    <div
      style={{
        padding: "4px 12px",
        fontSize: 11,
        color: "var(--text-dim)",
        background: "var(--bg-surface)",
        borderTop: "1px solid var(--border)",
        display: "flex",
        gap: 12,
        fontFamily: "'JetBrains Mono', monospace",
        flexShrink: 0,
      }}
    >
      {!mobile && <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{activeTab.path}</span>}
      {mobile && <span style={{ flex: 1 }} />}
      <span>{activeTab.language}</span>
      <span>{t(activeTab.dirty ? "editor.modified" : "editor.saved")}</span>
      {!mobile && <span title={t("editor.saveHint", { shortcut })}>{shortcut}</span>}
    </div>
  );
}
