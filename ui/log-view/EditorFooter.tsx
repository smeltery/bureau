import type { Tab } from "./editor-model.ts";

export function EditorFooter({ activeTab, mobile }: { activeTab: Tab | null; mobile: boolean }) {
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
      <span>{activeTab.dirty ? "modified" : "saved"}</span>
      {!mobile && <span title="Ctrl+S to save">{(navigator.platform || "").includes("Mac") ? "⌘S" : "Ctrl+S"}</span>}
    </div>
  );
}
