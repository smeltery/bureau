import type { ServerWebSocket } from "bun";
import type { ClientCommand, ServerMessage, TaskItem } from "../../shared/types.ts";
import { generateTaskId, isValidPriority, isValidStatus } from "../../shared/types.ts";
import * as AgentManager from "../agent-manager.ts";
import * as CronjobManager from "../cronjobs/index.ts";
import { saveRecentCwd, saveTasks } from "../persistence.ts";
import { broadcast, setTasks, tasks } from "./broadcast.ts";

export async function handleCommand(cmd: ClientCommand, ws: ServerWebSocket<unknown>) {
  switch (cmd.type) {
    case "ping":
      ws.send(JSON.stringify({ type: "pong" } as ServerMessage));
      break;
    case "spawn": {
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
      await AgentManager.kill(cmd.agentId);
      break;
    case "abort":
      await AgentManager.abort(cmd.agentId);
      break;
    case "send_message":
      // Don't await — let it stream in the background
      AgentManager.sendMessage(cmd.agentId, cmd.text, cmd.username, cmd.attachments);
      break;
    case "new_conversation":
      await AgentManager.newConversation(cmd.agentId);
      break;
    case "resume":
      await AgentManager.resume(cmd.agentId, cmd.sessionId);
      break;
    case "edit_agent": {
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
      AgentManager.swapDesks(cmd.deskA, cmd.deskB, cmd.roomId);
      break;
    case "set_topic":
      AgentManager.setTopic(cmd.agentId, cmd.topic);
      break;
    case "reset_topic":
      AgentManager.resetTopic(cmd.agentId);
      break;
    case "list_sessions": {
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
      AgentManager.terminalInput(cmd.agentId, cmd.data);
      break;
    case "terminal_resize":
      AgentManager.terminalResize(cmd.agentId, cmd.cols, cmd.rows);
      break;
    case "terminal_close":
      AgentManager.closeTerminal(cmd.agentId);
      break;
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
      AgentManager.createRoom(cmd.name);
      break;
    case "close_room":
      AgentManager.closeRoom(cmd.roomId);
      break;
    case "rename_room":
      AgentManager.renameRoom(cmd.roomId, cmd.name);
      break;
    case "move_agent":
      AgentManager.moveAgent(cmd.agentId, cmd.targetRoomId);
      break;
    case "reorder_rooms":
      AgentManager.reorderRooms(cmd.order);
      break;
    case "edit_message":
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
  }
}
