import type { ServerMessage } from "../shared/types.ts";
import { stopWatch, watchFile, type FileWatcher } from "./file-editor.ts";
import { getSessionContext } from "./users.ts";
import { browsers } from "./ws/broadcast.ts";

export const editorWatchers = new WeakMap<import("bun").ServerWebSocket<unknown>, Map<string, FileWatcher>>();

function editorKey(agentId: string, path: string): string {
  return `${agentId}\0${path}`;
}

export function findBrowserConnection(connectionId: string, sessionIdHash: string): import("bun").ServerWebSocket<unknown> | null {
  for (const ws of browsers) {
    const session = (ws.data as { session?: { sessionIdHash: string } | null } | undefined)?.session ?? null;
    if (session?.sessionIdHash !== sessionIdHash) continue;
    if (getSessionContext(ws)?.connectionId === connectionId) return ws;
  }
  return null;
}

export function watchEditorFile(agentId: string, absPath: string, connectionId: string) {
  for (const ws of browsers) {
    if (getSessionContext(ws)?.connectionId !== connectionId) continue;
    const map = editorWatchers.get(ws) ?? new Map<string, FileWatcher>();
    editorWatchers.set(ws, map);
    const key = editorKey(agentId, absPath);
    const old = map.get(key);
    if (old) stopWatch(old);
    const watcher = watchFile(absPath, agentId, (mtime) => {
      ws.send(JSON.stringify({ type: "editor_external_change", agentId, path: absPath, mtime } as ServerMessage));
    });
    if (watcher) map.set(key, watcher);
    return;
  }
}

export function closeEditorWatch(agentId: string, absPath: string, connectionId: string) {
  for (const ws of browsers) {
    if (getSessionContext(ws)?.connectionId !== connectionId) continue;
    const map = editorWatchers.get(ws);
    const watcher = map?.get(editorKey(agentId, absPath));
    if (!watcher) return;
    stopWatch(watcher);
    map!.delete(editorKey(agentId, absPath));
    return;
  }
}

export function closeEditorWatchesFor(ws: import("bun").ServerWebSocket<unknown>) {
  const map = editorWatchers.get(ws);
  if (!map) return;
  for (const watcher of map.values()) stopWatch(watcher);
  editorWatchers.delete(ws);
}
