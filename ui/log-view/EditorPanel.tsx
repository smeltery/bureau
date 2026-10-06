import { useRef, useCallback, useState, useMemo } from "react";
import { send } from "../ws.ts";
import { useTheme } from "../store.tsx";
import { getEditorState } from "./editor-state.ts";
import { basename, dirname, readRecentFiles, writeTabs, type Tab } from "./editor-model.ts";
import { EditorBanner } from "./EditorBanner.tsx";
import { EditorFooter } from "./EditorFooter.tsx";
import { EditorTabsHeader } from "./EditorTabsHeader.tsx";
import { useCodeMirrorEditor } from "./hooks/useCodeMirrorEditor.ts";
import { useEditorPanelLifecycle } from "./hooks/useEditorPanelLifecycle.ts";
import { useEditorSocket } from "./hooks/useEditorSocket.ts";
import { useEditorSelectionCite } from "./hooks/useEditorSelectionCite.ts";
import { CiteSelectionButton } from "./CiteSelectionButton.tsx";

export function EditorPanel({
  agentId,
  initialPath,
  onClose,
  onPathOpened,
  onCite,
  mobile = false,
}: {
  agentId: string;
  initialPath: string | null;
  onClose: () => void;
  onPathOpened?: (path: string) => void;
  onCite?: (text: string, title: string) => void;
  // When true, renders mobile-friendly chrome: a tab dropdown instead of an
  // overflowing tab strip, an explicit Save button (mobile has no Ctrl+S),
  // a hidden line-number gutter, no autocomplete popup, and contentAttributes
  // that disable iOS autocorrect/autocapitalize on the editable surface.
  mobile?: boolean;
}) {
  const { mode } = useTheme();

  // Restore from the module-level store on mount so tabs and dirty buffers
  // survive LogView remount on agent switch. (LogView is keyed by agent id
  // in App.tsx, which fully unmounts the column on each switch — local
  // useState would lose the buffer.) Banner state is volatile, never
  // restored, so the user doesn't see a stale "stale-save" prompt that was
  // resolved before they navigated away.
  const [tabs, setTabs] = useState<Tab[]>(() => {
    const persisted = getEditorState(agentId);
    if (!persisted) return [];
    return persisted.tabs.map((t) => ({
      path: t.path,
      content: t.content,
      mtime: t.mtime,
      rev: t.rev ?? 0,
      language: t.language,
      size: t.size,
      dirty: t.dirty,
      banner: null,
    }));
  });
  const [activePath, setActivePath] = useState<string | null>(() => {
    return getEditorState(agentId)?.activePath ?? null;
  });
  const [pendingError, setPendingError] = useState<string | null>(null);
  const [tabMenuOpen, setTabMenuOpen] = useState(false);
  const [recentPaths, setRecentPaths] = useState<string[]>(() => readRecentFiles(agentId));
  const tabMenuRef = useRef<HTMLDivElement>(null);
  const tabMenuButtonRef = useRef<HTMLButtonElement>(null);

  const tabsRef = useRef<Tab[]>([]);
  tabsRef.current = tabs;

  const setTabsAndPersist = useCallback(
    (updater: (prev: Tab[]) => Tab[]) => {
      setTabs((prev) => {
        const next = updater(prev);
        writeTabs(
          agentId,
          next.map((t) => t.path),
        );
        return next;
      });
    },
    [agentId],
  );
  const { containerRef, viewRef, activePathRef } = useCodeMirrorEditor({ mode, mobile, tabs, activePath, setTabsAndPersist });
  const { cite, clearCite } = useEditorSelectionCite(viewRef, containerRef, activePath, !mobile && !!onCite);

  useEditorSocket({ agentId, setPendingError, setActivePath, setTabsAndPersist, setRecentPaths, tabsRef });

  const saveActiveTab = useCallback(() => {
    const path = activePathRef.current;
    if (!path) return;
    const tab = tabsRef.current.find((t) => t.path === path);
    if (!tab) return;
    send({ type: "editor_save", agentId, path, content: tab.content, expectedMtime: tab.mtime, expectedRev: tab.rev || undefined });
  }, [agentId]);

  const openRecentPath = useCallback(
    (path: string) => {
      setPendingError(null);
      setActivePath(path);
      send({ type: "editor_open", agentId, path });
    },
    [agentId],
  );

  useEditorPanelLifecycle({
    activePath,
    agentId,
    initialPath,
    onPathOpened,
    saveActiveTab,
    setActivePath,
    setPendingError,
    setTabMenuOpen,
    tabMenuButtonRef,
    tabMenuOpen,
    tabMenuRef,
    tabs,
    tabsRef,
    viewRef,
  });

  const closeTab = useCallback(
    (path: string) => {
      send({ type: "editor_close", agentId, path });
      setTabsAndPersist((prev) => prev.filter((t) => t.path !== path));
      setActivePath((prev) => {
        if (prev !== path) return prev;
        const remaining = tabsRef.current.filter((t) => t.path !== path);
        return remaining.length > 0 ? remaining[remaining.length - 1]!.path : null;
      });
      // If we just closed the last tab, force the mobile dropdown shut so a
      // fresh editor_content arrival (e.g. an EditRequestCard tap) doesn't
      // surprise the user by re-opening the menu they thought they'd left.
      if (tabsRef.current.length <= 1) {
        setTabMenuOpen(false);
      }
    },
    [agentId, setTabsAndPersist],
  );

  const activeTab = useMemo(() => tabs.find((t) => t.path === activePath) ?? null, [tabs, activePath]);

  const overwrite = useCallback(() => {
    if (!activeTab) return;
    // Force-save: bypass mtime check.
    send({
      type: "editor_save",
      agentId,
      path: activeTab.path,
      content: activeTab.content,
      expectedMtime: activeTab.mtime,
      expectedRev: activeTab.rev || undefined,
      force: true,
    });
  }, [activeTab, agentId]);

  const recreateFromBuffer = useCallback(() => {
    overwrite();
  }, [overwrite]);

  const reloadFromDisk = useCallback(() => {
    if (!activeTab) return;
    send({ type: "editor_open", agentId, path: activeTab.path });
  }, [activeTab, agentId]);

  const dismissBanner = useCallback(() => {
    if (!activeTab) return;
    setTabsAndPersist((prev) => prev.map((t) => (t.path === activeTab.path ? { ...t, banner: null } : t)));
  }, [activeTab, setTabsAndPersist]);

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        // borderLeft removed — the parent container's PanelResizer renders
        // the divider so it can be drag-targeted and hover-tinted.
        background: "var(--bg-base)",
        position: "relative",
        // Clip the mobile tab-dropdown so a deep file list never overflows
        // past the editor's bottom edge into the chat column behind. Desktop
        // has no popover, so the clipping is a no-op there.
        overflow: mobile ? "hidden" : undefined,
      }}
    >
      <EditorTabsHeader
        mobile={mobile}
        tabs={tabs}
        activePath={activePath}
        activeTab={activeTab}
        tabMenuOpen={tabMenuOpen}
        tabMenuRef={tabMenuRef}
        tabMenuButtonRef={tabMenuButtonRef}
        onToggleTabMenu={() => setTabMenuOpen((v) => !v)}
        onSelectTab={(path) => {
          setActivePath(path);
          setTabMenuOpen(false);
        }}
        onCloseTab={closeTab}
        onSave={saveActiveTab}
        onClose={onClose}
      />

      <EditorBanner
        activeTab={activeTab}
        pendingError={pendingError}
        onOverwrite={overwrite}
        onReload={reloadFromDisk}
        onRecreate={recreateFromBuffer}
        onCloseTab={() => {
          if (activeTab) closeTab(activeTab.path);
        }}
        onDismissBanner={dismissBanner}
        onDismissError={() => setPendingError(null)}
      />

      {/* Editor body */}
      <div
        ref={containerRef}
        style={{
          flex: 1,
          overflow: "auto",
          fontFamily: "'JetBrains Mono', monospace",
          fontSize: 13,
          display: activeTab ? undefined : "none",
        }}
      />
      {cite && onCite && containerRef.current && (
        <CiteSelectionButton
          cite={cite}
          containerRect={containerRef.current.getBoundingClientRect()}
          onClick={() => {
            onCite(cite.text, cite.title);
            clearCite();
          }}
        />
      )}

      {tabs.length === 0 && recentPaths.length > 0 && (
        <div
          style={{
            padding: mobile ? "12px 12px 8px" : "10px 12px 6px",
            borderTop: "1px solid var(--border-subtle)",
            borderBottom: "1px solid var(--border)",
            background: "var(--bg-surface)",
            flexShrink: 0,
            overflowY: "auto",
            maxHeight: "60%",
          }}
        >
          <div
            style={{
              fontSize: 10,
              fontWeight: 700,
              letterSpacing: 1,
              textTransform: "uppercase",
              color: "var(--text-ghost)",
              marginBottom: 6,
            }}
          >
            Recently opened
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 1 }}>
            {recentPaths.map((path) => (
              <button
                key={path}
                onClick={() => openRecentPath(path)}
                title={path}
                style={{
                  display: "flex",
                  alignItems: "baseline",
                  gap: 8,
                  width: "100%",
                  textAlign: "left",
                  padding: mobile ? "8px 8px" : "4px 8px",
                  background: "transparent",
                  border: "none",
                  borderRadius: 4,
                  cursor: "pointer",
                  fontFamily: "'JetBrains Mono',monospace",
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = "var(--bg-subtle)";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = "transparent";
                }}
              >
                <span
                  style={{
                    fontSize: mobile ? 14 : 12,
                    color: "var(--text-secondary)",
                    flexShrink: 0,
                  }}
                >
                  {basename(path)}
                </span>
                <span
                  style={{
                    fontSize: mobile ? 11 : 10,
                    color: "var(--text-ghost)",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {dirname(path)}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}

      {!activeTab && (
        <div
          style={{
            flex: 1,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: "var(--text-ghost)",
            fontSize: 13,
            borderTop: "1px solid var(--border-subtle)",
          }}
        >
          No file open
        </div>
      )}

      <EditorFooter activeTab={activeTab} mobile={mobile} />
    </div>
  );
}
