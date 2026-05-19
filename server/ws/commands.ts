import type { ServerWebSocket } from "bun";
import type { ClientCommand, ServerMessage, TaskItem } from "../../shared/types.ts";
import { generateTaskId, isValidPriority, isValidStatus } from "../../shared/types.ts";
import * as AgentManager from "../agent-manager.ts";
import * as CronjobManager from "../cronjobs/index.ts";
import { saveRecentCwd, saveTasks } from "../persistence.ts";
import { broadcast, browsers, setTasks, tasks } from "./broadcast.ts";
import { stopWatch, watchFile } from "../file-editor.ts";
import { editorWatchers } from "../index.ts";
import { pushPresenceListToEachWs, sendInitialPayload } from "../index.ts";
import { canSeeRoom, claimUser, deleteUser, getSessionContext, getWsUser, listActiveSessions, updateUser } from "../users.ts";
import { refreshPresenceForUser, setPresence } from "../presence.ts";

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

function canUseAgent(ws: ServerWebSocket<unknown>, agentId: string): boolean {
  const agent = AgentManager.getAllAgents().find((a) => a.id === agentId);
  if (!agent) return false;
  const roomId = AgentManager.getRooms()[agent.room]?.id;
  return !!roomId && canSeeRoom(getWsUser(ws), roomId);
}

function canUseRoom(ws: ServerWebSocket<unknown>, roomId: string): boolean {
  return canSeeRoom(getWsUser(ws), roomId);
}

function isOwner(ws: ServerWebSocket<unknown>): boolean {
  return getWsUser(ws)?.role === "owner";
}

export async function handleCommand(cmd: ClientCommand, ws: ServerWebSocket<unknown>) {
  switch (cmd.type) {
    case "ping":
      ws.send(JSON.stringify({ type: "pong" } as ServerMessage));
      break;
    case "claim_user": {
      claimUser(ws, cmd.username, AgentManager.getRooms());
      sendInitialPayload(ws);
      pushPresenceListToEachWs();
      break;
    }
    case "update_user": {
      const updated = updateUser(getWsUser(ws), cmd.userId, cmd.changes, AgentManager.getRooms());
      for (const browser of browsers) {
        sendInitialPayload(browser);
      }
      if (updated) {
        refreshPresenceForUser(updated.id, { name: updated.name, avatarColor: updated.avatarColor, avatarVariant: updated.avatarVariant }, new Set(updated.allowedRooms));
        pushPresenceListToEachWs();
      }
      break;
    }
    case "delete_user": {
      deleteUser(getWsUser(ws), cmd.userId);
      for (const browser of browsers) {
        sendInitialPayload(browser);
      }
      break;
    }
    case "list_active_sessions":
      ws.send(JSON.stringify({ type: "sessions_active_list", sessions: listActiveSessions() } as ServerMessage));
      break;
    case "revoke_session":
      ws.send(JSON.stringify({ type: "sessions_active_list", sessions: listActiveSessions().filter((s) => s.sessionPrefix !== cmd.sessionPrefix) } as ServerMessage));
      break;
    case "logout":
      ws.send(JSON.stringify({ type: "session_context", context: null } as ServerMessage));
      break;
    case "presence_update": {
      const user = getWsUser(ws);
      if (!user) break;
      const rooms = AgentManager.getRooms();
      const visibleRooms = user.role === "owner" ? rooms : rooms.filter((r) => user.allowedRooms.includes(r.id));
      const roomId = cmd.currentRoom !== null && Number.isInteger(cmd.currentRoom) ? (visibleRooms[cmd.currentRoom]?.id ?? null) : null;
      let focusedAgentId: string | null = null;
      if (roomId && cmd.focusedAgentId) {
        const agent = AgentManager.getAllAgents().find((a) => a.id === cmd.focusedAgentId);
        if (agent && rooms[agent.room]?.id === roomId) focusedAgentId = agent.id;
      }
      const connectionId = getSessionContext(ws)?.connectionId ?? "";
      const changed = setPresence({
        connectionId,
        userId: user.id,
        username: user.name,
        device: cmd.device ?? null,
        avatarColor: user.avatarColor,
        avatarVariant: user.avatarVariant,
        currentRoomId: roomId,
        focusedAgentId,
        viewMode: cmd.viewMode === "log" || cmd.viewMode === "away" ? cmd.viewMode : "office",
        lastSeenAt: Date.now(),
      });
      if (changed) pushPresenceListToEachWs();
      break;
    }
    case "spawn": {
      if (cmd.roomId && !canUseRoom(ws, cmd.roomId)) break;
      try {
        AgentManager.validateCwd(cmd.cwd);
      } catch (err: any) {
        if (cmd.requestId) {
          ws.send(JSON.stringify({ type: "agent_save_response", requestId: cmd.requestId, ok: false, error: err.message || "Invalid directory" } as ServerMessage));
        }
        break;
      }
      saveRecentCwd(cmd.cwd);
      await AgentManager.spawn(cmd.name, cmd.cwd, cmd.permissionMode, cmd.desk, cmd.customInstructions, cmd.roomId, cmd.outfit, cmd.modelFamily);
      if (cmd.requestId) {
        ws.send(JSON.stringify({ type: "agent_save_response", requestId: cmd.requestId, ok: true } as ServerMessage));
      }
      break;
    }
    case "kill":
      if (!canUseAgent(ws, cmd.agentId)) break;
      await AgentManager.kill(cmd.agentId);
      break;
    case "abort":
      if (!canUseAgent(ws, cmd.agentId)) break;
      await AgentManager.abort(cmd.agentId);
      break;
    case "send_message":
      if (!canUseAgent(ws, cmd.agentId)) break;
      // Don't await — let it stream in the background
      AgentManager.sendMessage(cmd.agentId, cmd.text, cmd.username, cmd.attachments);
      break;
    case "dequeue_message":
      if (!canUseAgent(ws, cmd.agentId)) break;
      AgentManager.dequeueMessage(cmd.agentId, cmd.queuedId);
      break;
    case "new_conversation":
      if (!canUseAgent(ws, cmd.agentId)) break;
      await AgentManager.newConversation(cmd.agentId);
      break;
    case "resume":
      if (!canUseAgent(ws, cmd.agentId)) break;
      await AgentManager.resume(cmd.agentId, cmd.sessionId);
      break;
    case "edit_agent": {
      if (!canUseAgent(ws, cmd.agentId)) break;
      if (cmd.cwd) {
        try {
          AgentManager.validateCwd(cmd.cwd);
        } catch (err: any) {
          if (cmd.requestId) {
            ws.send(JSON.stringify({ type: "agent_save_response", requestId: cmd.requestId, ok: false, error: err.message || "Invalid directory" } as ServerMessage));
          }
          break;
        }
        saveRecentCwd(cmd.cwd);
      }
      AgentManager.editAgent(cmd.agentId, {
        name: cmd.name,
        cwd: cmd.cwd,
        outfit: cmd.outfit,
        customInstructions: cmd.customInstructions,
        modelFamily: cmd.modelFamily,
        permissionMode: cmd.permissionMode,
      });
      if (cmd.requestId) {
        ws.send(JSON.stringify({ type: "agent_save_response", requestId: cmd.requestId, ok: true } as ServerMessage));
      }
      break;
    }
    case "swap_desks":
      if (!canUseRoom(ws, cmd.roomId)) break;
      AgentManager.swapDesks(cmd.deskA, cmd.deskB, cmd.roomId);
      break;
    case "set_topic":
      if (!canUseAgent(ws, cmd.agentId)) break;
      AgentManager.setTopic(cmd.agentId, cmd.topic);
      break;
    case "reset_topic":
      if (!canUseAgent(ws, cmd.agentId)) break;
      AgentManager.resetTopic(cmd.agentId);
      break;
    case "list_sessions": {
      if (!canUseAgent(ws, cmd.agentId)) break;
      const sessions = AgentManager.listSessions(cmd.agentId);
      const currentSessionId = AgentManager.getCurrentSessionId(cmd.agentId);
      broadcast({
        type: "sessions_list",
        agentId: cmd.agentId,
        sessions,
        currentSessionId,
      } as ServerMessage);
      break;
    }
    case "terminal_open": {
      if (!canUseAgent(ws, cmd.agentId)) break;
      const opened = AgentManager.openTerminal(cmd.agentId);
      if (opened) {
        // Replay buffered output so the browser catches up
        const buffer = AgentManager.getTerminalBuffer(cmd.agentId);
        if (buffer) {
          broadcast({ type: "terminal_output", agentId: cmd.agentId, data: buffer } as ServerMessage);
        }
      }
      break;
    }
    case "terminal_input":
      if (!canUseAgent(ws, cmd.agentId)) break;
      AgentManager.terminalInput(cmd.agentId, cmd.data);
      break;
    case "terminal_resize":
      if (!canUseAgent(ws, cmd.agentId)) break;
      AgentManager.terminalResize(cmd.agentId, cmd.cols, cmd.rows);
      break;
    case "terminal_close":
      if (!canUseAgent(ws, cmd.agentId)) break;
      AgentManager.closeTerminal(cmd.agentId);
      break;
    case "editor_open": {
      if (!canUseAgent(ws, cmd.agentId)) break;
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
        break;
      }
      const r = probe.result;
      if (r.kind !== "ok") {
        ws.send(
          JSON.stringify({
            type: "editor_open_error",
            agentId: cmd.agentId,
            path: r.path,
            reason: r.kind,
            message: r.kind === "io_error" ? r.message : undefined,
            size: r.kind === "too_large" ? r.size : undefined,
          } as ServerMessage),
        );
        break;
      }
      ws.send(
        JSON.stringify({
          type: "editor_content",
          agentId: cmd.agentId,
          path: r.path,
          content: r.content,
          mtime: r.mtime,
          language: r.language,
          size: r.size,
        } as ServerMessage),
      );
      // Install (or replace) the per-WS watcher so external edits surface as
      // `editor_external_change`. Replacing collapses duplicate opens.
      const map = getWatcherMap(ws);
      const key = editorKey(cmd.agentId, r.path);
      const old = map.get(key);
      if (old) stopWatch(old);
      const watcher = watchFile(r.path, cmd.agentId, (mtime) => {
        ws.send(JSON.stringify({ type: "editor_external_change", agentId: cmd.agentId, path: r.path, mtime } as ServerMessage));
      });
      if (watcher) map.set(key, watcher);
      break;
    }
    case "editor_save": {
      if (!canUseAgent(ws, cmd.agentId)) break;
      const abs = AgentManager.resolveEditorPathForAgent(cmd.agentId, cmd.path);
      if (!abs) {
        ws.send(JSON.stringify({ type: "editor_save_response", agentId: cmd.agentId, path: cmd.path, ok: false, error: "agent not found" } as ServerMessage));
        break;
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
      break;
    }
    case "editor_close": {
      if (!canUseAgent(ws, cmd.agentId)) break;
      const abs = AgentManager.resolveEditorPathForAgent(cmd.agentId, cmd.path);
      if (!abs) break;
      const map = getWatcherMap(ws);
      const key = editorKey(cmd.agentId, abs);
      const w = map.get(key);
      if (w) {
        stopWatch(w);
        map.delete(key);
      }
      break;
    }
    case "update_office_settings": {
      const envFile = cmd.envFile && cmd.envFile.trim() ? cmd.envFile.trim() : null;
      if (envFile) {
        try {
          AgentManager.validateEnvPath(envFile);
        } catch (err: any) {
          ws.send(JSON.stringify({ type: "settings_save_response", requestId: cmd.requestId, ok: false, error: err.message || "Invalid env file" } as ServerMessage));
          break;
        }
      }
      AgentManager.setOfficeSettings(cmd.prompt, envFile);
      ws.send(JSON.stringify({ type: "settings_save_response", requestId: cmd.requestId, ok: true } as ServerMessage));
      break;
    }
    case "update_room_settings": {
      if (!canUseRoom(ws, cmd.roomId)) break;
      const envFile = cmd.envFile && cmd.envFile.trim() ? cmd.envFile.trim() : null;
      if (envFile) {
        try {
          AgentManager.validateEnvPath(envFile);
        } catch (err: any) {
          ws.send(JSON.stringify({ type: "settings_save_response", requestId: cmd.requestId, ok: false, error: err.message || "Invalid env file" } as ServerMessage));
          break;
        }
      }
      const ok = AgentManager.setRoomSettings(cmd.roomId, cmd.prompt, envFile);
      if (!ok) {
        ws.send(JSON.stringify({ type: "settings_save_response", requestId: cmd.requestId, ok: false, error: "Room not found" } as ServerMessage));
      } else {
        ws.send(JSON.stringify({ type: "settings_save_response", requestId: cmd.requestId, ok: true } as ServerMessage));
      }
      break;
    }
    case "request_cwd_validation": {
      try {
        AgentManager.validateCwd(cmd.cwd);
        ws.send(JSON.stringify({ type: "cwd_validation", requestId: cmd.requestId, ok: true } as ServerMessage));
      } catch (err: any) {
        ws.send(JSON.stringify({ type: "cwd_validation", requestId: cmd.requestId, ok: false, error: err.message || "Invalid directory" } as ServerMessage));
      }
      break;
    }
    case "request_settings_validation": {
      let envFile: string | null = null;
      if (cmd.scope === "office") {
        envFile = AgentManager.getOfficeSettings().envFile;
      } else if (cmd.scope === "room" && cmd.roomId) {
        const room = AgentManager.getRooms().find((r) => r.id === cmd.roomId);
        envFile = room?.envFile ?? null;
      }
      if (!envFile) {
        ws.send(JSON.stringify({ type: "settings_validation", requestId: cmd.requestId, scope: cmd.scope, roomId: cmd.roomId, envFile: null, ok: true } as ServerMessage));
        break;
      }
      try {
        const keyCount = AgentManager.validateEnvPath(envFile);
        ws.send(JSON.stringify({ type: "settings_validation", requestId: cmd.requestId, scope: cmd.scope, roomId: cmd.roomId, envFile, ok: true, keyCount } as ServerMessage));
      } catch (err: any) {
        ws.send(
          JSON.stringify({
            type: "settings_validation",
            requestId: cmd.requestId,
            scope: cmd.scope,
            roomId: cmd.roomId,
            envFile,
            ok: false,
            error: err.message || "Invalid env file",
          } as ServerMessage),
        );
      }
      break;
    }
    case "add_task": {
      const task: TaskItem = {
        id: generateTaskId(tasks.map((t) => t.id)),
        title: cmd.title.trim(),
        description: cmd.description,
        priority: cmd.priority && isValidPriority(cmd.priority) ? cmd.priority : undefined,
        status: "open",
        assignee: cmd.assignee,
        createdBy: cmd.username,
        createdAt: Date.now(),
      };
      tasks.push(task);
      saveTasks(tasks);
      broadcast({ type: "tasks", tasks } as ServerMessage);
      break;
    }
    case "update_task": {
      const task = tasks.find((t) => t.id === cmd.id);
      if (task) {
        const c = cmd.changes;
        if (c.title !== undefined) task.title = String(c.title);
        if (c.description !== undefined) task.description = c.description ? String(c.description) : undefined;
        if (c.assignee !== undefined) task.assignee = c.assignee ? String(c.assignee) : undefined;
        if (c.status !== undefined && isValidStatus(c.status)) task.status = c.status;
        if (c.priority !== undefined && isValidPriority(c.priority)) task.priority = c.priority;
        saveTasks(tasks);
        broadcast({ type: "tasks", tasks } as ServerMessage);
      }
      break;
    }
    case "delete_task": {
      const next = tasks.filter((t) => t.id !== cmd.id);
      setTasks(next);
      saveTasks(next);
      broadcast({ type: "tasks", tasks: next } as ServerMessage);
      break;
    }
    case "create_room":
      if (!isOwner(ws)) break;
      AgentManager.createRoom(cmd.name);
      pushPresenceListToEachWs();
      break;
    case "close_room":
      if (!canUseRoom(ws, cmd.roomId)) break;
      AgentManager.closeRoom(cmd.roomId);
      pushPresenceListToEachWs();
      break;
    case "rename_room":
      if (!canUseRoom(ws, cmd.roomId)) break;
      AgentManager.renameRoom(cmd.roomId, cmd.name);
      break;
    case "move_agent":
      if (!canUseAgent(ws, cmd.agentId) || !canUseRoom(ws, cmd.targetRoomId)) break;
      AgentManager.moveAgent(cmd.agentId, cmd.targetRoomId);
      break;
    case "reorder_rooms":
      if (!isOwner(ws)) break;
      AgentManager.reorderRooms(cmd.order);
      pushPresenceListToEachWs();
      break;
    case "edit_message":
      if (!canUseAgent(ws, cmd.agentId)) break;
      // Don't await — let it stream in the background (like send_message)
      AgentManager.editMessage(cmd.agentId, cmd.logEntryId, cmd.newText, cmd.username);
      break;
    case "add_cronjob": {
      try {
        AgentManager.validateCwd(cmd.cwd);
      } catch (err: any) {
        if (cmd.requestId) {
          ws.send(JSON.stringify({ type: "agent_save_response", requestId: cmd.requestId, ok: false, error: err.message || "Invalid directory" } as ServerMessage));
        }
        break;
      }
      saveRecentCwd(cmd.cwd);
      CronjobManager.addCronjob({
        name: cmd.name,
        schedule: cmd.schedule,
        prompt: cmd.prompt,
        cwd: cmd.cwd,
        modelFamily: cmd.modelFamily,
        permissionMode: cmd.permissionMode,
        username: cmd.username,
        device: cmd.device,
      });
      if (cmd.requestId) {
        ws.send(JSON.stringify({ type: "agent_save_response", requestId: cmd.requestId, ok: true } as ServerMessage));
      }
      break;
    }
    case "update_cronjob": {
      if (cmd.changes.cwd) {
        try {
          AgentManager.validateCwd(cmd.changes.cwd);
        } catch (err: any) {
          if (cmd.requestId) {
            ws.send(JSON.stringify({ type: "agent_save_response", requestId: cmd.requestId, ok: false, error: err.message || "Invalid directory" } as ServerMessage));
          }
          break;
        }
        saveRecentCwd(cmd.changes.cwd);
      }
      CronjobManager.updateCronjob(cmd.id, cmd.changes);
      if (cmd.requestId) {
        ws.send(JSON.stringify({ type: "agent_save_response", requestId: cmd.requestId, ok: true } as ServerMessage));
      }
      break;
    }
    case "delete_cronjob":
      CronjobManager.deleteCronjob(cmd.id);
      break;
    case "run_cronjob_now":
      CronjobManager.runCronjobNow(cmd.id, cmd.username, cmd.device);
      break;
    case "update_cronjobs_prompt":
      CronjobManager.setCronjobsPrompt(cmd.value);
      ws.send(JSON.stringify({ type: "settings_save_response", requestId: cmd.requestId, ok: true } as ServerMessage));
      break;
    case "list_cronjob_runs": {
      const runs = CronjobManager.getRunsForCronjob(cmd.cronjobId);
      ws.send(JSON.stringify({ type: "cronjob_runs", cronjobId: cmd.cronjobId, runs } as ServerMessage));
      break;
    }
    case "list_all_cronjob_runs": {
      // Returns runs for every cronjob dir on disk (including deleted ones)
      // so the Runs tab can surface historical runs after a cronjob is gone.
      for (const { jobId, runs } of CronjobManager.getAllRunsByJob()) {
        ws.send(JSON.stringify({ type: "cronjob_runs", cronjobId: jobId, runs } as ServerMessage));
      }
      // Sentinel so the client can flip its "runs loaded" flag even when no
      // cronjob has ever fired (no run dirs on disk = zero cronjob_runs sent).
      ws.send(JSON.stringify({ type: "cronjob_runs_complete" } as ServerMessage));
      break;
    }
    case "load_cronjob_run": {
      // Client passes jobId from the run row it just clicked, so no scan
      // needed. Works for runs from deleted cronjobs too: getRunTranscript
      // reads from disk regardless of whether the cronjob config still exists.
      const { entries } = CronjobManager.getRunTranscript(cmd.cronjobId, cmd.runId);
      for (const entry of entries) {
        ws.send(JSON.stringify({ type: "log_entry", entry } as ServerMessage));
      }
      break;
    }
    case "send_cronjob_run_message":
      // Don't await — let it stream in the background (matches send_message).
      CronjobManager.sendRunMessage(cmd.cronjobId, cmd.runId, cmd.text, cmd.username);
      break;
    case "edit_cronjob_run_message":
      // Don't await — let it stream in the background (matches edit_message).
      CronjobManager.editRunMessage(cmd.cronjobId, cmd.runId, cmd.logEntryId, cmd.newText, cmd.username);
      break;
  }
}
