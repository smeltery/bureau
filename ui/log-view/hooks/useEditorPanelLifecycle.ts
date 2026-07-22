import { useCallback, useEffect, type Dispatch, type MutableRefObject, type RefObject, type SetStateAction } from "react";
import type { EditorView } from "@codemirror/view";
import { send } from "../../ws.ts";
import { getEditorState, setEditorState, type PersistedTab } from "../editor-state.ts";
import { readTabs, type Tab } from "../editor-model.ts";

export function useEditorPanelLifecycle({
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
}: {
  activePath: string | null;
  agentId: string;
  initialPath: string | null;
  onPathOpened?: (path: string) => void;
  saveActiveTab: () => void;
  setActivePath: Dispatch<SetStateAction<string | null>>;
  setPendingError: (value: string | null) => void;
  setTabMenuOpen: Dispatch<SetStateAction<boolean>>;
  tabMenuButtonRef: RefObject<HTMLButtonElement | null>;
  tabMenuOpen: boolean;
  tabMenuRef: RefObject<HTMLDivElement | null>;
  tabs: Tab[];
  tabsRef: MutableRefObject<Tab[]>;
  viewRef: MutableRefObject<EditorView | null>;
}) {
  const openPath = useCallback(
    (path: string) => {
      setPendingError(null);
      send({ type: "editor_open", agentId, path });
    },
    [agentId, setPendingError],
  );

  // Mirror tabs + active path into the module store on every change so an
  // agent switch round-trip can restore them. Banner state is dropped on
  // purpose (see EditorPanel's state initializer).
  useEffect(() => {
    const snapshot: PersistedTab[] = tabs.map((t) => ({
      path: t.path,
      content: t.content,
      mtime: t.mtime,
      rev: t.rev,
      language: t.language,
      size: t.size,
      dirty: t.dirty,
    }));
    setEditorState(agentId, { tabs: snapshot, activePath });
  }, [agentId, tabs, activePath]);

  // First mount: figure out where to load from.
  //   1. Module store wins because it preserves dirty buffers. We still send
  //      editor_open for restored paths so the server reinstalls fs.watch.
  //   2. Else, if parent passed initialPath, the initialPath effect handles it.
  //   3. Else, fall back to localStorage paths from a prior session.
  useEffect(() => {
    const persisted = getEditorState(agentId);
    if (persisted && persisted.tabs.length > 0) {
      for (const tab of persisted.tabs) openPath(tab.path);
      return;
    }
    if (initialPath) return;
    const stored = readTabs(agentId);
    for (const path of stored) openPath(path);
    if (stored.length > 0) setActivePath(stored[stored.length - 1] ?? null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Whenever a new initialPath arrives, either focus the existing tab or open
  // the file. Activate it optimistically so it becomes the active tab even
  // when restored tabs previously selected a different active path.
  useEffect(() => {
    if (!initialPath) return;
    setActivePath(initialPath);
    const existing = tabsRef.current.find((t) => t.path === initialPath);
    if (!existing) openPath(initialPath);
    onPathOpened?.(initialPath);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialPath]);

  // Release server-side fs.watch handles on unmount. X-button per-tab close
  // already sends editor_close; this covers LogView resets and agent switches.
  useEffect(() => {
    return () => {
      for (const tab of tabsRef.current) {
        send({ type: "editor_close", agentId, path: tab.path });
      }
    };
  }, [agentId, tabsRef]);

  // Save with Ctrl+S / Cmd+S; capture prevents the browser save dialog.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key !== "s" || (!e.ctrlKey && !e.metaKey)) return;
      const view = viewRef.current;
      if (!view) return;
      if (!view.dom.contains(document.activeElement)) return;
      e.preventDefault();
      saveActiveTab();
    }
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [saveActiveTab, viewRef]);

  // Close the mobile tab menu when the boss taps outside it or its anchor.
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
  }, [setTabMenuOpen, tabMenuButtonRef, tabMenuOpen, tabMenuRef]);
}
