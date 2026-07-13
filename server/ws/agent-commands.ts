import type { ServerWebSocket } from "bun";
import type { ClientCommand, ServerMessage } from "../../shared/types.ts";
import * as AgentManager from "../agent-manager.ts";
import { pushPresenceListToEachWs } from "../index.ts";
import { saveRecentCwd } from "../persistence.ts";
import { getWsUser } from "../users.ts";
import { broadcast } from "./broadcast.ts";
import { handleEditorCommand } from "./editor-commands.ts";
import { canUseRoom } from "./user-commands.ts";

function canUseAgent(ws: ServerWebSocket<unknown>, agentId: string): boolean {
  const agent = AgentManager.getAllAgents().find((a) => a.id === agentId);
  if (!agent) return false;
  const roomId = AgentManager.getRooms()[agent.room]?.id;
  return !!roomId && canUseRoom(ws, roomId);
}

function isOwner(ws: ServerWebSocket<unknown>): boolean {
  return getWsUser(ws)?.role === "owner";
}

export async function handleAgentCommand(cmd: ClientCommand, ws: ServerWebSocket<unknown>): Promise<boolean> {
  switch (cmd.type) {
    case "ping":
      ws.send(JSON.stringify({ type: "pong" } as ServerMessage));
      return true;
    case "spawn": {
      if (cmd.roomId && !canUseRoom(ws, cmd.roomId)) return true;
      try {
        AgentManager.validateCwd(cmd.cwd);
      } catch (err: any) {
        if (cmd.requestId) {
          ws.send(JSON.stringify({ type: "agent_save_response", requestId: cmd.requestId, ok: false, error: err.message || "Invalid directory" } as ServerMessage));
        }
        return true;
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
      return true;
    }
    case "kill":
      if (!canUseAgent(ws, cmd.agentId)) return true;
      await AgentManager.kill(cmd.agentId);
      return true;
    case "revive": {
      // Gate on the TARGET room (where the agent is being placed). revive()
      // re-validates the original room's existence server-side, so a member
      // can only revive into a room they can access.
      if (!canUseRoom(ws, cmd.roomId)) return true;
      const result = await AgentManager.revive(cmd.agentId, cmd.roomId, cmd.desk);
      if (cmd.requestId) {
        ws.send(JSON.stringify({ type: "agent_save_response", requestId: cmd.requestId, ok: result.ok, error: result.ok ? undefined : result.error } as ServerMessage));
      }
      return true;
    }
    case "abort":
      if (!canUseAgent(ws, cmd.agentId)) return true;
      await AgentManager.abort(cmd.agentId);
      return true;
    case "send_message":
      if (!canUseAgent(ws, cmd.agentId)) return true;
      // Don't await — let it stream in the background
      AgentManager.sendMessage(cmd.agentId, cmd.text, cmd.username, cmd.attachments);
      return true;
    case "dequeue_message":
      if (!canUseAgent(ws, cmd.agentId)) return true;
      AgentManager.dequeueMessage(cmd.agentId, cmd.queuedId);
      return true;
    case "send_now":
      if (!canUseAgent(ws, cmd.agentId)) return true;
      AgentManager.sendNow(cmd.agentId).catch((err: any) => {
        console.error(`sendNow failed for ${cmd.agentId}:`, err.message);
      });
      return true;
    case "new_conversation":
      if (!canUseAgent(ws, cmd.agentId)) return true;
      await AgentManager.newConversation(cmd.agentId);
      return true;
    case "resume":
      if (!canUseAgent(ws, cmd.agentId)) return true;
      await AgentManager.resume(cmd.agentId, cmd.sessionId);
      return true;
    case "edit_agent": {
      if (!canUseAgent(ws, cmd.agentId)) return true;
      if (cmd.cwd) {
        try {
          AgentManager.validateCwd(cmd.cwd);
        } catch (err: any) {
          if (cmd.requestId) {
            ws.send(JSON.stringify({ type: "agent_save_response", requestId: cmd.requestId, ok: false, error: err.message || "Invalid directory" } as ServerMessage));
          }
          return true;
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
      return true;
    }
    case "set_agent_privileged": {
      if (!isOwner(ws) || !canUseAgent(ws, cmd.agentId)) return true;
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
      return true;
    }
    case "swap_desks":
      if (!canUseRoom(ws, cmd.roomId)) return true;
      AgentManager.swapDesks(cmd.deskA, cmd.deskB, cmd.roomId);
      return true;
    case "set_topic":
      if (!canUseAgent(ws, cmd.agentId)) return true;
      AgentManager.setTopic(cmd.agentId, cmd.topic);
      return true;
    case "reset_topic":
      if (!canUseAgent(ws, cmd.agentId)) return true;
      AgentManager.resetTopic(cmd.agentId);
      return true;
    case "list_sessions": {
      if (!canUseAgent(ws, cmd.agentId)) return true;
      const sessions = AgentManager.listSessions(cmd.agentId);
      const currentSessionId = AgentManager.getCurrentSessionId(cmd.agentId);
      broadcast({
        type: "sessions_list",
        agentId: cmd.agentId,
        sessions,
        currentSessionId,
      } as ServerMessage);
      return true;
    }
    case "terminal_open": {
      if (!canUseAgent(ws, cmd.agentId)) return true;
      const opened = AgentManager.openTerminal(cmd.agentId);
      if (opened) {
        // Replay buffered output so the browser catches up
        const buffer = AgentManager.getTerminalBuffer(cmd.agentId);
        if (buffer) {
          broadcast({ type: "terminal_output", agentId: cmd.agentId, data: buffer } as ServerMessage);
        }
      }
      return true;
    }
    case "terminal_input":
      if (!canUseAgent(ws, cmd.agentId)) return true;
      AgentManager.terminalInput(cmd.agentId, cmd.data);
      return true;
    case "terminal_resize":
      if (!canUseAgent(ws, cmd.agentId)) return true;
      AgentManager.terminalResize(cmd.agentId, cmd.cols, cmd.rows);
      return true;
    case "terminal_close":
      if (!canUseAgent(ws, cmd.agentId)) return true;
      AgentManager.closeTerminal(cmd.agentId);
      return true;
    case "editor_open":
    case "editor_save":
    case "editor_close":
      handleEditorCommand(cmd, ws, (agentId) => canUseAgent(ws, agentId));
      return true;
    case "create_room":
      if (!isOwner(ws)) return true;
      AgentManager.createRoom(cmd.name);
      pushPresenceListToEachWs();
      return true;
    case "close_room":
      if (!canUseRoom(ws, cmd.roomId)) return true;
      AgentManager.closeRoom(cmd.roomId);
      pushPresenceListToEachWs();
      return true;
    case "rename_room":
      if (!canUseRoom(ws, cmd.roomId)) return true;
      AgentManager.renameRoom(cmd.roomId, cmd.name);
      return true;
    case "move_agent":
      if (!canUseAgent(ws, cmd.agentId) || !canUseRoom(ws, cmd.targetRoomId)) return true;
      AgentManager.moveAgent(cmd.agentId, cmd.targetRoomId);
      return true;
    case "reorder_rooms":
      if (!isOwner(ws)) return true;
      AgentManager.reorderRooms(cmd.order);
      pushPresenceListToEachWs();
      return true;
    case "edit_message":
      if (!canUseAgent(ws, cmd.agentId)) return true;
      // Don't await — let it stream in the background (like send_message)
      AgentManager.editMessage(cmd.agentId, cmd.logEntryId, cmd.newText, cmd.username);
      return true;
    default:
      return false;
  }
}
