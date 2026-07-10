import type { ServerWebSocket } from "bun";
import type { ClientCommand, ServerMessage } from "../../shared/types.ts";
import * as AgentManager from "../agent-manager.ts";
import * as CronjobManager from "../cronjobs/index.ts";
import { saveRecentCwd } from "../persistence.ts";
import { broadcast, browsers } from "./broadcast.ts";
import { pushPresenceListToEachWs, sendInitialPayload } from "../index.ts";
import { canSeeRoom, claimUser, deleteUser, getSessionContext, getUserById, getWsUser, updateUser, wouldDeleteLeaveNoOwner } from "../users.ts";
import { refreshPresenceForUser, setPresence } from "../presence.ts";
import { evictSessionsForUserId } from "../auth/auth.ts";
import { handleAccessCommand } from "./access-commands.ts";
import { handleEditorCommand } from "./editor-commands.ts";
import { handleTaskCommand } from "./task-commands.ts";

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
  if (await handleAccessCommand(cmd, ws)) return;
  if (handleTaskCommand(cmd)) return;

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
      const envFile = cmd.changes.envFile;
      if (typeof envFile === "string" && envFile.trim()) {
        try {
          AgentManager.validateEnvPath(envFile.trim());
        } catch (err) {
          console.warn(`[users] rejected envFile update: ${(err as Error).message}`);
          break;
        }
      }
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
      const actor = getWsUser(ws);
      if (!actor || actor.role !== "owner") break;
      // Lockout-prevention: refuse deletion that would leave the office
      // without any owner record on disk. Defense in depth: same invariant
      // as the session-revoke check, applied to user records.
      if (wouldDeleteLeaveNoOwner(cmd.userId)) {
        console.warn(`[auth] delete_user "${cmd.userId}" refused: would leave office with no owners`);
        break;
      }
      deleteUser(actor, cmd.userId);
      for (const browser of browsers) {
        sendInitialPayload(browser);
      }
      // Evict any sessions the deleted user still had open: their browsers
      // get session_expired + close so they land on the login wall instead
      // of looping reconnect against a now-orphaned cookie.
      await evictSessionsForUserId(cmd.userId);
      break;
    }
    case "presence_update": {
      const user = getWsUser(ws);
      if (!user) break;
      const rooms = AgentManager.getRooms();
      const visibleRooms = user.role === "owner" ? rooms : rooms.filter((r) => user.allowedRooms.includes(r.id));
      const visibleRoomIds = new Set(visibleRooms.map((r) => r.id));
      const roomId =
        cmd.currentRoomId && visibleRoomIds.has(cmd.currentRoomId)
          ? cmd.currentRoomId
          : cmd.currentRoom !== null && Number.isInteger(cmd.currentRoom)
            ? (visibleRooms[cmd.currentRoom]?.id ?? null)
            : null;
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
      await AgentManager.spawn(
        cmd.name,
        cmd.cwd,
        cmd.permissionMode,
        cmd.desk,
        cmd.customInstructions,
        cmd.roomId,
        cmd.outfit,
        cmd.modelFamily,
        cmd.agentType ?? "claude",
        cmd.codexSandbox,
        cmd.effort,
        getWsUser(ws)?.id ?? null,
      );
      if (cmd.requestId) {
        ws.send(JSON.stringify({ type: "agent_save_response", requestId: cmd.requestId, ok: true } as ServerMessage));
      }
      break;
    }
    case "kill":
      if (!canUseAgent(ws, cmd.agentId)) break;
      await AgentManager.kill(cmd.agentId);
      break;
    case "revive": {
      // Gate on the TARGET room (where the agent is being placed). revive()
      // re-validates the original room's existence server-side, so a member
      // can only revive into a room they can access.
      if (!canUseRoom(ws, cmd.roomId)) break;
      const result = await AgentManager.revive(cmd.agentId, cmd.roomId, cmd.desk);
      if (cmd.requestId) {
        ws.send(JSON.stringify({ type: "agent_save_response", requestId: cmd.requestId, ok: result.ok, error: result.ok ? undefined : result.error } as ServerMessage));
      }
      break;
    }
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
    case "send_now":
      if (!canUseAgent(ws, cmd.agentId)) break;
      AgentManager.sendNow(cmd.agentId).catch((err: any) => {
        console.error(`sendNow failed for ${cmd.agentId}:`, err.message);
      });
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
      try {
        await AgentManager.editAgent(cmd.agentId, {
          name: cmd.name,
          cwd: cmd.cwd,
          outfit: cmd.outfit,
          customInstructions: cmd.customInstructions,
          modelFamily: cmd.modelFamily,
          permissionMode: cmd.permissionMode,
          codexSandbox: cmd.codexSandbox,
          effort: cmd.effort,
        });
        if (cmd.requestId) {
          ws.send(JSON.stringify({ type: "agent_save_response", requestId: cmd.requestId, ok: true } as ServerMessage));
        }
      } catch (err) {
        if (cmd.requestId) {
          ws.send(JSON.stringify({ type: "agent_save_response", requestId: cmd.requestId, ok: false, error: err instanceof Error ? err.message : "Save failed" } as ServerMessage));
        }
      }
      break;
    }
    case "set_agent_privileged": {
      if (!isOwner(ws) || !canUseAgent(ws, cmd.agentId)) break;
      try {
        await AgentManager.setAgentPrivileged(cmd.agentId, cmd.privileged);
        if (cmd.requestId) {
          ws.send(JSON.stringify({ type: "agent_save_response", requestId: cmd.requestId, ok: true } as ServerMessage));
        }
      } catch (err) {
        if (cmd.requestId) {
          ws.send(
            JSON.stringify({
              type: "agent_save_response",
              requestId: cmd.requestId,
              ok: false,
              error: err instanceof Error ? err.message : "Failed to update agent privilege",
            } as ServerMessage),
          );
        }
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
      handleEditorCommand(cmd, ws, (agentId) => canUseAgent(ws, agentId));
      break;
    }
    case "editor_save": {
      handleEditorCommand(cmd, ws, (agentId) => canUseAgent(ws, agentId));
      break;
    }
    case "editor_close": {
      handleEditorCommand(cmd, ws, (agentId) => canUseAgent(ws, agentId));
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
      let userId: string | undefined;
      if (cmd.scope === "office") {
        envFile = AgentManager.getOfficeSettings().envFile;
      } else if (cmd.scope === "room" && cmd.roomId) {
        const room = AgentManager.getRooms().find((r) => r.id === cmd.roomId);
        envFile = room?.envFile ?? null;
      } else if (cmd.scope === "user") {
        const actor = getWsUser(ws);
        const target = cmd.userId ? getUserById(cmd.userId) : actor;
        if (!actor || !target || (actor.role !== "owner" && actor.id !== target.id)) {
          ws.send(
            JSON.stringify({
              type: "settings_validation",
              requestId: cmd.requestId,
              scope: cmd.scope,
              userId: cmd.userId,
              envFile: null,
              ok: false,
              error: "User env validation is not allowed.",
            } as ServerMessage),
          );
          break;
        }
        userId = target.id;
        envFile = cmd.envFile !== undefined ? cmd.envFile?.trim() || null : (target.envFile ?? null);
      }
      if (!envFile) {
        ws.send(JSON.stringify({ type: "settings_validation", requestId: cmd.requestId, scope: cmd.scope, roomId: cmd.roomId, userId, envFile: null, ok: true } as ServerMessage));
        break;
      }
      try {
        const keyCount = AgentManager.validateEnvPath(envFile);
        ws.send(JSON.stringify({ type: "settings_validation", requestId: cmd.requestId, scope: cmd.scope, roomId: cmd.roomId, userId, envFile, ok: true, keyCount } as ServerMessage));
      } catch (err: any) {
        ws.send(
          JSON.stringify({
            type: "settings_validation",
            requestId: cmd.requestId,
            scope: cmd.scope,
            roomId: cmd.roomId,
            userId,
            envFile,
            ok: false,
            error: err.message || "Invalid env file",
          } as ServerMessage),
        );
      }
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
        agentType: cmd.agentType,
        modelFamily: cmd.modelFamily,
        effort: cmd.effort,
        permissionMode: cmd.permissionMode,
        codexSandbox: cmd.codexSandbox,
        username: cmd.username,
        userId: getWsUser(ws)?.id ?? null,
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
