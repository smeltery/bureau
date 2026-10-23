import { useEffect } from "react";
import type { ServerMessage } from "../../../shared/types.ts";
import { addRawListener, removeRawListener, send } from "../../ws.ts";
import { rememberRecentFile, type Tab, type EditorOpenError } from "../editor-model.ts";

export function useEditorSocket({
  agentId,
  setPendingError,
  setActivePath,
  setTabsAndPersist,
  setRecentPaths,
  tabsRef,
  reloadsRef,
}: {
  agentId: string;
  setPendingError: (value: EditorOpenError | null) => void;
  setActivePath: (updater: (prev: string | null) => string | null) => void;
  setTabsAndPersist: (updater: (prev: Tab[]) => Tab[]) => void;
  setRecentPaths: (paths: string[]) => void;
  tabsRef: React.MutableRefObject<Tab[]>;
  reloadsRef: React.MutableRefObject<Map<string, string>>;
}) {
  useEffect(() => {
    const handler = (data: string) => {
      let msg: ServerMessage | null = null;
      try {
        msg = JSON.parse(data) as ServerMessage;
      } catch {
        return;
      }
      if (!msg) return;
      if (msg.type === "editor_content" && msg.agentId === agentId) {
        const m = msg;
        const reloadContent = reloadsRef.current.get(m.path);
        reloadsRef.current.delete(m.path);
        setRecentPaths(rememberRecentFile(agentId, m.path));
        setTabsAndPersist((prev) => {
          const idx = prev.findIndex((t) => t.path === m.path);
          if (idx >= 0) {
            const existing = prev[idx]!;
            const next = prev.slice();
            // Only an explicit reload may replace a dirty buffer, and edits made
            // while the read was in flight still win over its response.
            if (existing.dirty && existing.content !== reloadContent) {
              next[idx] = {
                ...existing,
                mtime: m.mtime,
                rev: m.rev,
                language: m.language,
                size: m.size,
              };
            } else {
              next[idx] = {
                path: m.path,
                content: m.content,
                mtime: m.mtime,
                rev: m.rev,
                language: m.language,
                size: m.size,
                dirty: false,
                banner: null,
              };
            }
            return next;
          }
          return [
            ...prev,
            {
              path: m.path,
              content: m.content,
              mtime: m.mtime,
              rev: m.rev,
              language: m.language,
              size: m.size,
              dirty: false,
              banner: null,
            },
          ];
        });
        setActivePath((prev) => prev ?? m.path);
      } else if (msg.type === "editor_open_error" && msg.agentId === agentId) {
        const m = msg;
        reloadsRef.current.delete(m.path);
        setPendingError(m);
      } else if (msg.type === "editor_save_response" && msg.agentId === agentId) {
        const m = msg;
        setTabsAndPersist((prev) =>
          prev.map((t) => {
            if (t.path !== m.path) return t;
            if (m.ok) {
              return { ...t, mtime: m.mtime ?? t.mtime, rev: m.rev ?? t.rev, dirty: false, banner: null };
            }
            if (m.reason === "stale" && m.currentMtime !== undefined) {
              return { ...t, banner: { kind: "stale", currentMtime: m.currentMtime } };
            }
            if (m.reason === "deleted") {
              return { ...t, banner: { kind: "deleted" } };
            }
            return { ...t, banner: { kind: "save_error", message: m.error } };
          }),
        );
      } else if (msg.type === "editor_external_change" && msg.agentId === agentId) {
        const m = msg;
        const existing = tabsRef.current.find((t) => t.path === m.path);
        if (!existing) return;
        if (existing.dirty) {
          setTabsAndPersist((prev) => prev.map((t) => (t.path === m.path ? { ...t, banner: { kind: "external", mtime: m.mtime } } : t)));
        } else {
          send({ type: "editor_open", agentId, path: m.path });
        }
      } else if (msg.type === "editor_file_deleted" && msg.agentId === agentId) {
        const m = msg;
        const existing = tabsRef.current.find((t) => t.path === m.path);
        if (!existing) return;
        setTabsAndPersist((prev) => prev.map((t) => (t.path === m.path ? { ...t, banner: { kind: "deleted" } } : t)));
      }
    };
    addRawListener(handler);
    return () => removeRawListener(handler);
  }, [agentId, setActivePath, setPendingError, setRecentPaths, setTabsAndPersist, tabsRef, reloadsRef]);
}
