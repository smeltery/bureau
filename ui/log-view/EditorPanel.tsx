import { useEffect, useRef, useCallback, useState, useMemo } from "react";
import { send } from "../ws.ts";
import { useTheme } from "../store.tsx";
import { getEditorState, setEditorState, type PersistedTab } from "./editor-state.ts";
import { readTabs, writeTabs, type Tab } from "./editor-model.ts";
import { EditorBanner } from "./EditorBanner.tsx";
import { EditorFooter } from "./EditorFooter.tsx";
import { EditorTabsHeader } from "./EditorTabsHeader.tsx";
import { useCodeMirrorEditor } from "./hooks/useCodeMirrorEditor.ts";
import { useEditorSocket } from "./hooks/useEditorSocket.ts";

export function EditorPanel({
  agentId,
  initialPath,
  onClose,
  onPathOpened,
  mobile = false,
}: {
  agentId: string;
  initialPath: string | null;
  onClose: () => void;
  onPathOpened?: (path: string) => void;
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

  // Mirror tabs + active path into the module store on every change so an
  // agent switch round-trip can restore them. Banner state is dropped on
  // purpose (see comment on the useState initializer).
  useEffect(() => {
    const snapshot: PersistedTab[] = tabs.map((t) => ({
      path: t.path,
      content: t.content,
      mtime: t.mtime,
      language: t.language,
      size: t.size,
      dirty: t.dirty,
    }));
    setEditorState(agentId, { tabs: snapshot, activePath });
  }, [agentId, tabs, activePath]);

  // Open a file by sending editor_open and waiting for editor_content.
  const openPath = useCallback(
    (path: string) => {
      setPendingError(null);
      send({ type: "editor_open", agentId, path });
    },
    [agentId],
  );

  // First mount: figure out where to load from.
  //   1. Module store (set by a previous mount of this agent's editor) wins
  //      because it preserves dirty buffers. We still send editor_open for
  //      each restored path so the server reinstalls fs.watch — the
  //      editor_content handler is careful to keep the dirty buffer.
  //   2. Else, if the parent passed an initialPath, the [initialPath] effect
  //      below handles it.
  //   3. Else, fall back to localStorage paths from a prior session and open
  //      them fresh from disk.
  useEffect(() => {
    const persisted = getEditorState(agentId);
    if (persisted && persisted.tabs.length > 0) {
      for (const t of persisted.tabs) openPath(t.path);
      return;
    }
    if (initialPath) return;
    const stored = readTabs(agentId);
    for (const p of stored) openPath(p);
    if (stored.length > 0) setActivePath(stored[stored.length - 1] ?? null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Whenever a new initialPath arrives — first mount with one, or the parent
  // sets a new path because the boss clicked another EditRequestCard —
  // either focus the existing tab or open the file. Activate it optimistically
  // so it becomes the active tab even when other tabs were restored from the
  // module store with a different activePath set already.
  useEffect(() => {
    if (!initialPath) return;
    setActivePath(initialPath);
    const existing = tabsRef.current.find((t) => t.path === initialPath);
    if (!existing) openPath(initialPath);
    onPathOpened?.(initialPath);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialPath]);

  useEditorSocket({ agentId, setPendingError, setActivePath, setTabsAndPersist, tabsRef });

  // Release server-side fs.watch handles when the panel unmounts (LogView
  // reset, agent switch, etc.). Without this, watchers persist on the WS
  // until disconnect — a slow inotify-slot leak for long-lived browser tabs.
  // X-button per-tab close already sends editor_close; this is the catch-all
  // for unmount paths the user didn't explicitly trigger.
  useEffect(() => {
    return () => {
      for (const t of tabsRef.current) {
        send({ type: "editor_close", agentId, path: t.path });
      }
    };
  }, [agentId]);

  const saveActiveTab = useCallback(() => {
    const path = activePathRef.current;
    if (!path) return;
    const tab = tabsRef.current.find((t) => t.path === path);
    if (!tab) return;
    send({ type: "editor_save", agentId, path, content: tab.content, expectedMtime: tab.mtime });
  }, [agentId]);

  // Save with Ctrl+S / Cmd+S — must capture to suppress browser save dialog.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key !== "s" || (!e.ctrlKey && !e.metaKey)) return;
      // Only intercept when an editor is actively focused, otherwise let other shortcuts win.
      const view = viewRef.current;
      if (!view) return;
      if (!view.dom.contains(document.activeElement)) return;
      e.preventDefault();
      saveActiveTab();
    }
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [saveActiveTab]);

  // Close the mobile tab menu when the boss taps anywhere outside it (or its
  // anchor button). pointerdown beats click so we close before a competing
  // tap target reads the open state.
  useEffect(() => {
    if (!tabMenuOpen) return;
    function onPointerDown(e: PointerEvent) {
      const target = e.target as Node;
      if (tabMenuRef.current?.contains(target)) return;
      if (tabMenuButtonRef.current?.contains(target)) return;
      setTabMenuOpen(false);
    }
    document.addEventListener("pointerdown", onPointerDown, true);
    return () => document.removeEventListener("pointerdown", onPointerDown, true);
  }, [tabMenuOpen]);

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
      force: true,
    });
  }, [activeTab, agentId]);

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

      <EditorBanner activeTab={activeTab} pendingError={pendingError} onOverwrite={overwrite} onReload={reloadFromDisk} onDismissBanner={dismissBanner} onDismissError={() => setPendingError(null)} />

      {/* Editor body */}
      <div
        ref={containerRef}
        style={{
          flex: 1,
          overflow: "auto",
          fontFamily: "'JetBrains Mono', monospace",
          fontSize: 13,
        }}
      />

      <EditorFooter activeTab={activeTab} mobile={mobile} />
    </div>
  );
}
