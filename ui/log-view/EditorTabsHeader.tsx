import type { RefObject } from "react";
import { basename, type Tab } from "./editor-model.ts";
import { EditorTabsMobileHeader } from "./EditorTabsMobileHeader.tsx";

export function EditorTabsHeader({
  mobile,
  tabs,
  activePath,
  activeTab,
  tabMenuOpen,
  tabMenuRef,
  tabMenuButtonRef,
  onToggleTabMenu,
  onSelectTab,
  onCloseTab,
  onSave,
  onClose,
}: {
  mobile: boolean;
  tabs: Tab[];
  activePath: string | null;
  activeTab: Tab | null;
  tabMenuOpen: boolean;
  tabMenuRef: RefObject<HTMLDivElement | null>;
  tabMenuButtonRef: RefObject<HTMLButtonElement | null>;
  onToggleTabMenu: () => void;
  onSelectTab: (path: string) => void;
  onCloseTab: (path: string) => void;
  onSave: () => void;
  onClose: () => void;
}) {
  if (mobile) {
    return (
      <EditorTabsMobileHeader
        tabs={tabs}
        activePath={activePath}
        activeTab={activeTab}
        tabMenuOpen={tabMenuOpen}
        tabMenuRef={tabMenuRef}
        tabMenuButtonRef={tabMenuButtonRef}
        onToggleTabMenu={onToggleTabMenu}
        onSelectTab={onSelectTab}
        onCloseTab={onCloseTab}
        onSave={onSave}
        onClose={onClose}
      />
    );
  }

  return (
    <div
      style={{
        display: "flex",
        alignItems: "stretch",
        borderBottom: "1px solid var(--border-strong)",
        background: "var(--bg-surface)",
        flexShrink: 0,
        minHeight: 36,
        overflowX: "auto",
      }}
    >
      <div style={{ display: "flex", flex: 1, minWidth: 0 }}>
        {tabs.length === 0 && (
          <div
            style={{
              fontSize: 11,
              color: "var(--text-dim)",
              padding: "0 12px",
              display: "flex",
              alignItems: "center",
            }}
          >
            No file open. Use <code style={{ margin: "0 4px", color: "var(--text-secondary)" }}>/bureau-edit &lt;path&gt;</code> or have the agent send one.
          </div>
        )}
        {tabs.map((t) => (
          <div
            key={t.path}
            onClick={() => onSelectTab(t.path)}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              padding: "0 8px 0 12px",
              fontFamily: "'JetBrains Mono',monospace",
              fontSize: 11,
              color: t.path === activePath ? "var(--text-secondary)" : "var(--text-muted)",
              background: t.path === activePath ? "var(--bg-base)" : "transparent",
              borderRight: "1px solid var(--border)",
              cursor: "pointer",
              flexShrink: 0,
              maxWidth: 200,
              position: "relative",
              ...(t.path === activePath ? { borderTop: "2px solid var(--green)" } : {}),
            }}
            title={t.path}
          >
            <span
              style={{
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {basename(t.path)}
              {t.dirty ? "*" : ""}
            </span>
            <button
              onClick={(e) => {
                e.stopPropagation();
                onCloseTab(t.path);
              }}
              style={{
                background: "none",
                border: "none",
                color: "var(--text-ghost)",
                cursor: "pointer",
                fontSize: 14,
                padding: "0 2px",
                lineHeight: 1,
              }}
              title="Close tab"
            >
              &times;
            </button>
          </div>
        ))}
      </div>
      <CloseEditorButton onClose={onClose} />
    </div>
  );
}

function CloseEditorButton({ onClose, mobile = false }: { onClose: () => void; mobile?: boolean }) {
  return (
    <button
      onClick={onClose}
      style={{
        background: "none",
        border: "none",
        color: "var(--text-muted)",
        cursor: "pointer",
        fontSize: mobile ? 24 : 16,
        padding: mobile ? "4px 12px" : "0 12px",
        lineHeight: 1,
        flexShrink: 0,
      }}
      title="Close editor"
    >
      &times;
    </button>
  );
}
