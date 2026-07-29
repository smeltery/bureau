import type { ServerWebSocket } from "bun";
import type { ClientCommand, ServerMessage } from "../../shared/types.ts";
import * as AgentManager from "../agent-manager.ts";
import { pushPresenceListToEachWs } from "../index.ts";
import { saveRecentCwd } from "../persistence.ts";
import { getWsUser } from "../users.ts";
import { handleAgentConversationCommand } from "./agent-conversation-commands.ts";
import { handleAgentTerminalCommand } from "./agent-terminal-commands.ts";
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

function canManageAgent(ws: ServerWebSocket<unknown>, agentId: string): boolean {
  const user = getWsUser(ws);
  const agent = AgentManager.getAllAgents().find((a) => a.id === agentId);
  return !!user && !!agent && (user.role === "owner" || agent.userId === user.id);
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
      const agent = await AgentManager.spawn(
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
        ws.send(
          JSON.stringify({
            type: "agent_save_response",
            requestId: cmd.requestId,
            ok: !!agent,
            error: agent ? undefined : "agent name is taken or desk is unavailable",
          } as ServerMessage),
        );
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
    case "dequeue_message":
    case "send_now":
    case "new_conversation":
    case "resume":
      await handleAgentConversationCommand(cmd, (agentId) => canUseAgent(ws, agentId), getWsUser(ws)?.id ?? null);
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
      if (!canUseAgent(ws, cmd.agentId) || !canManageAgent(ws, cmd.agentId)) return true;
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
    case "reset_topic":
    case "list_sessions":
      await handleAgentConversationCommand(cmd, (agentId) => canUseAgent(ws, agentId), getWsUser(ws)?.id ?? null);
      return true;
    case "terminal_open":
    case "terminal_input":
    case "terminal_resize":
    case "terminal_close":
      handleAgentTerminalCommand(cmd, (agentId) => canUseAgent(ws, agentId));
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
      await handleAgentConversationCommand(cmd, (agentId) => canUseAgent(ws, agentId), getWsUser(ws)?.id ?? null);
      return true;
    default:
      return false;
  }
}
