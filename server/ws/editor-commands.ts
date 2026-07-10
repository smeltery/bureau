import type { ServerWebSocket } from "bun";
import type { ClientCommand, ServerMessage } from "../../shared/types.ts";
import * as AgentManager from "../agent-manager.ts";
import { stopWatch, watchFile } from "../file-editor.ts";
import { editorWatchers } from "../index.ts";

function editorKey(agentId: string, absPath: string): string {
  return `${agentId}\0${absPath}`;
}

function getWatcherMap(ws: ServerWebSocket<unknown>) {
  let map = editorWatchers.get(ws);
  if (!map) {
    map = new Map();
    editorWatchers.set(ws, map);
  }
  return map;
}

export type EditorCommand = Extract<ClientCommand, { type: "editor_open" | "editor_save" | "editor_close" }>;

export function handleEditorCommand(cmd: EditorCommand, ws: ServerWebSocket<unknown>, canUseAgent: (agentId: string) => boolean) {
  switch (cmd.type) {
    case "editor_open":
      handleEditorOpen(cmd, ws, canUseAgent);
      return;
    case "editor_save":
      handleEditorSave(cmd, ws, canUseAgent);
      return;
    case "editor_close":
      handleEditorClose(cmd, ws, canUseAgent);
      return;
  }
}

function handleEditorOpen(cmd: Extract<EditorCommand, { type: "editor_open" }>, ws: ServerWebSocket<unknown>, canUseAgent: (agentId: string) => boolean) {
  if (!canUseAgent(cmd.agentId)) return;
  const probe = AgentManager.openEditorFile(cmd.agentId, cmd.path);
  if (!probe.ok) {
    ws.send(
      JSON.stringify({
        type: "editor_open_error",
        agentId: cmd.agentId,
        path: cmd.path,
        reason: probe.error === "not_agent" ? "io_error" : "bad_path",
        message: probe.error === "not_agent" ? "agent not found" : undefined,
      } as ServerMessage),
    );
    return;
  }
  const result = probe.result;
  if (result.kind !== "ok") {
    ws.send(
      JSON.stringify({
        type: "editor_open_error",
        agentId: cmd.agentId,
        path: result.path,
        reason: result.kind,
        message: result.kind === "io_error" ? result.message : undefined,
        size: result.kind === "too_large" ? result.size : undefined,
      } as ServerMessage),
    );
    return;
  }
  ws.send(
    JSON.stringify({
      type: "editor_content",
      agentId: cmd.agentId,
      path: result.path,
      content: result.content,
      mtime: result.mtime,
      language: result.language,
      size: result.size,
    } as ServerMessage),
  );
  // Install (or replace) the per-WS watcher so external edits surface as
  // `editor_external_change`. Replacing collapses duplicate opens.
  const map = getWatcherMap(ws);
  const key = editorKey(cmd.agentId, result.path);
  const old = map.get(key);
  if (old) stopWatch(old);
  const watcher = watchFile(result.path, cmd.agentId, (mtime) => {
    ws.send(JSON.stringify({ type: "editor_external_change", agentId: cmd.agentId, path: result.path, mtime } as ServerMessage));
  });
  if (watcher) map.set(key, watcher);
}

function handleEditorSave(cmd: Extract<EditorCommand, { type: "editor_save" }>, ws: ServerWebSocket<unknown>, canUseAgent: (agentId: string) => boolean) {
  if (!canUseAgent(cmd.agentId)) return;
  const abs = AgentManager.resolveEditorPathForAgent(cmd.agentId, cmd.path);
  if (!abs) {
    ws.send(JSON.stringify({ type: "editor_save_response", agentId: cmd.agentId, path: cmd.path, ok: false, error: "agent not found" } as ServerMessage));
    return;
  }
  const result = AgentManager.saveEditorFile(abs, cmd.content, cmd.expectedMtime, cmd.force ?? false);
  if (result.kind === "ok") {
    ws.send(JSON.stringify({ type: "editor_save_response", agentId: cmd.agentId, path: result.path, ok: true, mtime: result.mtime } as ServerMessage));
  } else if (result.kind === "stale") {
    ws.send(
      JSON.stringify({
        type: "editor_save_response",
        agentId: cmd.agentId,
        path: result.path,
        ok: false,
        reason: "stale",
        currentMtime: result.currentMtime,
        error: "File changed on disk since you opened it.",
      } as ServerMessage),
    );
  } else {
    ws.send(JSON.stringify({ type: "editor_save_response", agentId: cmd.agentId, path: result.path, ok: false, error: result.message } as ServerMessage));
  }
}

function handleEditorClose(cmd: Extract<EditorCommand, { type: "editor_close" }>, ws: ServerWebSocket<unknown>, canUseAgent: (agentId: string) => boolean) {
  if (!canUseAgent(cmd.agentId)) return;
  const abs = AgentManager.resolveEditorPathForAgent(cmd.agentId, cmd.path);
  if (!abs) return;
  const map = getWatcherMap(ws);
  const key = editorKey(cmd.agentId, abs);
  const watcher = map.get(key);
  if (watcher) {
    stopWatch(watcher);
    map.delete(key);
  }
}
