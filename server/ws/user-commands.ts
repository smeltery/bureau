import type { ServerWebSocket } from "bun";
import type { ClientCommand } from "../../shared/types.ts";
import { LOBBY_ROOM_ID } from "../../shared/lobby.ts";
import * as AgentManager from "../agent-manager.ts";
import { evictSessionsForUserId } from "../auth/auth.ts";
import { pushPresenceListToEachWs, sendInitialPayload } from "../ws-initial-payload.ts";
import { refreshPresenceForUser, setPresence } from "../presence.ts";
import { canSeeRoom, claimUser, deleteUser, getSessionContext, getUserById, getWsUser, updateUser, wouldDeleteLeaveNoOwner } from "../users.ts";
import { browsers } from "./broadcast.ts";

export async function handleUserCommand(cmd: ClientCommand, ws: ServerWebSocket<unknown>): Promise<boolean> {
  switch (cmd.type) {
    case "claim_user": {
      claimUser(ws, cmd.username, AgentManager.getRooms());
      sendInitialPayload(ws);
      pushPresenceListToEachWs();
      return true;
    }
    case "update_user": {
      const envFile = cmd.changes.envFile;
      if (typeof envFile === "string" && envFile.trim()) {
        try {
          AgentManager.validateEnvPath(envFile.trim());
        } catch (err) {
          console.warn(`[users] rejected envFile update: ${(err as Error).message}`);
          return true;
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
      return true;
    }
    case "delete_user": {
      const actor = getWsUser(ws);
      if (!actor || actor.role !== "owner") return true;
      // Lockout-prevention: refuse deletion that would leave the office
      // without any owner record on disk. Defense in depth: same invariant
      // as the session-revoke check, applied to user records.
      if (wouldDeleteLeaveNoOwner(cmd.userId)) {
        console.warn(`[auth] delete_user "${cmd.userId}" refused: would leave office with no owners`);
        return true;
      }
      deleteUser(actor, cmd.userId);
      for (const browser of browsers) {
        sendInitialPayload(browser);
      }
      // Evict any sessions the deleted user still had open: their browsers
      // get session_expired + close so they land on the login wall instead
      // of looping reconnect against a now-orphaned cookie.
      await evictSessionsForUserId(cmd.userId);
      return true;
    }
    case "presence_update": {
      const user = getWsUser(ws);
      if (!user) return true;
      const rooms = AgentManager.getRooms();
      const visibleRooms = user.role === "owner" ? rooms : rooms.filter((r) => user.allowedRooms.includes(r.id));
      const visibleRoomIds = new Set(visibleRooms.map((r) => r.id));
      // Lobby is a client scene, not a desk RoomWire — every signed-in member may stand there.
      visibleRoomIds.add(LOBBY_ROOM_ID);
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
      return true;
    }
    default:
      return false;
  }
}

export function canUseRoom(ws: ServerWebSocket<unknown>, roomId: string): boolean {
  return canSeeRoom(getWsUser(ws), roomId);
}
