import type { ServerWebSocket } from "bun";
import type { ClientCommand, ServerMessage } from "../../shared/types.ts";
import * as AgentManager from "../agent-manager.ts";
import { saveRecentCwd } from "../persistence.ts";
import { broadcast } from "./broadcast.ts";
import { pushPresenceListToEachWs } from "../index.ts";
import { getWsUser } from "../users.ts";
import { handleAccessCommand } from "./access-commands.ts";
import { handleCronjobCommand } from "./cronjob-commands.ts";
import { handleEditorCommand } from "./editor-commands.ts";
import { handleSettingsCommand } from "./settings-commands.ts";
import { handleTaskCommand } from "./task-commands.ts";
import { canUseRoom, handleUserCommand } from "./user-commands.ts";

function canUseAgent(ws: ServerWebSocket<unknown>, agentId: string): boolean {
  const agent = AgentManager.getAllAgents().find((a) => a.id === agentId);
  if (!agent) return false;
  const roomId = AgentManager.getRooms()[agent.room]?.id;
  return !!roomId && canUseRoom(ws, roomId);
}

function isOwner(ws: ServerWebSocket<unknown>): boolean {
  return getWsUser(ws)?.role === "owner";
}

export async function handleCommand(cmd: ClientCommand, ws: ServerWebSocket<unknown>) {
  if (await handleAccessCommand(cmd, ws)) return;
  if (handleTaskCommand(cmd)) return;
  if (await handleUserCommand(cmd, ws)) return;
  if (handleCronjobCommand(cmd, ws)) return;
  if (handleSettingsCommand(cmd, ws, (roomId) => canUseRoom(ws, roomId))) return;

  switch (cmd.type) {
    case "ping":
      ws.send(JSON.stringify({ type: "pong" } as ServerMessage));
      break;
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
  }
}
