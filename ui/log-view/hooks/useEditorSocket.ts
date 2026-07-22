import { useEffect } from "react";
import type { ServerMessage } from "../../../shared/types.ts";
import { addRawListener, removeRawListener, send } from "../../ws.ts";
import { rememberRecentFile, type Tab } from "../editor-model.ts";

export function useEditorSocket({
  agentId,
  setPendingError,
  setActivePath,
  setTabsAndPersist,
  setRecentPaths,
  tabsRef,
}: {
  agentId: string;
  setPendingError: (value: string | null) => void;
  setActivePath: (updater: (prev: string | null) => string | null) => void;
  setTabsAndPersist: (updater: (prev: Tab[]) => Tab[]) => void;
  setRecentPaths: (paths: string[]) => void;
  tabsRef: React.MutableRefObject<Tab[]>;
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
        setRecentPaths(rememberRecentFile(agentId, m.path));
        setTabsAndPersist((prev) => {
          const idx = prev.findIndex((t) => t.path === m.path);
          if (idx >= 0) {
            const existing = prev[idx]!;
            const next = prev.slice();
            if (existing.dirty) {
              next[idx] = {
                ...existing,
                mtime: m.mtime,
                language: m.language,
                size: m.size,
              };
            } else {
              next[idx] = {
                path: m.path,
                content: m.content,
                mtime: m.mtime,
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
        const reason =
          m.reason === "not_found"
            ? "not found"
            : m.reason === "not_file"
              ? "not a file"
              : m.reason === "binary"
                ? "binary file (text only)"
                : m.reason === "too_large"
                  ? `too large (${m.size ? (m.size / 1024).toFixed(1) + " KB" : ""}, 1 MB limit)`
                  : m.reason === "io_error"
                    ? `error: ${m.message ?? "unknown"}`
                    : "bad path";
        setPendingError(`${m.path}: ${reason}`);
      } else if (msg.type === "editor_save_response" && msg.agentId === agentId) {
        const m = msg;
        setTabsAndPersist((prev) =>
          prev.map((t) => {
            if (t.path !== m.path) return t;
            if (m.ok) {
              return { ...t, mtime: m.mtime ?? t.mtime, dirty: false, banner: null };
            }
            if (m.reason === "stale" && m.currentMtime !== undefined) {
              return { ...t, banner: { kind: "stale", currentMtime: m.currentMtime } };
            }
            if (m.reason === "deleted") {
              return { ...t, banner: { kind: "deleted" } };
            }
            return { ...t, banner: { kind: "save_error", message: m.error ?? "save failed" } };
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
  }, [agentId, setActivePath, setPendingError, setRecentPaths, setTabsAndPersist, tabsRef]);
}
