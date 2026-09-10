import type { RefObject } from "react";
import { basename, type Tab } from "./editor-model.ts";
import { StatusShape } from "../icons/StatusShape.tsx";

export function EditorTabsMobileHeader({
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
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        borderBottom: "1px solid var(--border-strong)",
        background: "var(--bg-surface)",
        flexShrink: 0,
        minHeight: 44,
        position: "relative",
      }}
    >
      {tabs.length === 0 ? (
        <div
          style={{
            flex: 1,
            fontSize: 12,
            color: "var(--text-dim)",
            padding: "0 12px",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          No file open
        </div>
      ) : (
        <button
          ref={tabMenuButtonRef}
          onClick={onToggleTabMenu}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            flex: 1,
            minWidth: 0,
            height: "100%",
            padding: "0 12px",
            background: "transparent",
            border: "none",
            color: "var(--text-secondary)",
            fontFamily: "'JetBrains Mono',monospace",
            fontSize: 13,
            cursor: "pointer",
            textAlign: "left",
          }}
          title={activeTab?.path ?? ""}
        >
          <span
            style={{
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
              minWidth: 0,
            }}
          >
            {activeTab ? basename(activeTab.path) + (activeTab.dirty ? "*" : "") : "Select file"}
          </span>
          <span
            style={{
              fontSize: 11,
              color: "var(--text-muted)",
              flexShrink: 0,
            }}
          >
            <StatusShape kind="triangle" rotate={90} />
            {tabs.length > 1 ? ` ${tabs.length}` : ""}
          </span>
        </button>
      )}
      {activeTab?.dirty && (
        <button
          onClick={onSave}
          style={{
            flexShrink: 0,
            marginRight: 6,
            padding: "6px 14px",
            borderRadius: 6,
            border: "1px solid var(--green-border)",
            background: "var(--green-bg)",
            color: "var(--green)",
            fontFamily: "'JetBrains Mono', monospace",
            fontSize: 13,
            fontWeight: 500,
            cursor: "pointer",
          }}
          title="Save"
        >
          Save
        </button>
      )}
      <CloseEditorButton onClose={onClose} mobile />
      {tabMenuOpen && tabs.length > 0 && (
        <div
          ref={tabMenuRef}
          style={{
            position: "absolute",
            top: "100%",
            left: 0,
            right: 0,
            background: "var(--bg-surface)",
            border: "1px solid var(--border-strong)",
            borderTop: "none",
            maxHeight: 300,
            overflowY: "auto",
            zIndex: 5,
            boxShadow: "0 4px 12px var(--shadow)",
          }}
        >
          {tabs.map((t) => {
            const isActive = t.path === activePath;
            return (
              <div
                key={t.path}
                onClick={() => onSelectTab(t.path)}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  padding: "10px 12px",
                  fontFamily: "'JetBrains Mono', monospace",
                  fontSize: 13,
                  color: isActive ? "var(--text-primary)" : "var(--text-secondary)",
                  background: isActive ? "var(--bg-base)" : "transparent",
                  borderLeft: isActive ? "3px solid var(--green)" : "3px solid transparent",
                  borderBottom: "1px solid var(--border)",
                  cursor: "pointer",
                }}
                title={t.path}
              >
                <span
                  style={{
                    flex: 1,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                    minWidth: 0,
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
                    fontSize: 20,
                    minWidth: 44,
                    minHeight: 44,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    padding: 0,
                    lineHeight: 1,
                    flexShrink: 0,
                  }}
                  title="Close tab"
                >
                  &times;
                </button>
              </div>
            );
          })}
        </div>
      )}
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
