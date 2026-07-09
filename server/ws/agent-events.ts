import type { ServerMessage } from "../../shared/types.ts";
import * as AgentManager from "../agent-manager.ts";
import * as CronjobManager from "../cronjobs/index.ts";
import { canSeeRoom, getWsUser, projectAgents, projectRooms } from "../users.ts";
import { sendInitialPayload } from "../ws-initial-payload.ts";
import { broadcast, browsers } from "./broadcast.ts";

function sendToVisibleAgent(agentId: string, msg: ServerMessage) {
  const agent = AgentManager.getAllAgents().find((a) => a.id === agentId);
  const roomId = agent ? AgentManager.getRooms()[agent.room]?.id : null;
  for (const ws of browsers) {
    const user = getWsUser(ws);
    if (!roomId || canSeeRoom(user, roomId)) {
      if (msg.type === "agent_updated" && typeof msg.changes.room === "number" && user?.role === "member") {
        const projectedRooms = projectRooms(user, AgentManager.getRooms());
        const projectedRoom = projectedRooms.findIndex((r) => r.id === roomId);
        ws.send(JSON.stringify({ ...msg, changes: { ...msg.changes, room: projectedRoom, roomId } } as ServerMessage));
      } else if (msg.type === "agent_updated" && typeof msg.changes.room === "number") {
        ws.send(JSON.stringify({ ...msg, changes: { ...msg.changes, roomId } } as ServerMessage));
      } else if (msg.type === "agent_added" && user?.role === "member") {
        const projected = projectAgents(user, [msg.agent], AgentManager.getRooms())[0];
        if (projected) ws.send(JSON.stringify({ ...msg, agent: projected } as ServerMessage));
      } else if (msg.type === "agent_added") {
        const projected = projectAgents(user, [msg.agent], AgentManager.getRooms())[0];
        if (projected) ws.send(JSON.stringify({ ...msg, agent: projected } as ServerMessage));
      } else {
        ws.send(JSON.stringify(msg));
      }
    }
  }
}

export function wireAgentAndCronjobEvents() {
  // Wire AgentManager events to WebSocket broadcasts, filtering agent-scoped
  // events through each connection's room access.
  AgentManager.onEvent((event) => {
    if (event.type === "log_entry") {
      sendToVisibleAgent(event.entry.agentId, event as ServerMessage);
      return;
    }
    if (event.type === "agent_added") {
      sendToVisibleAgent(event.agent.id, event as ServerMessage);
      return;
    }
    if (event.type === "agent_updated") {
      sendToVisibleAgent(event.agentId, event as ServerMessage);
      return;
    }
    if (event.type === "killed_agent_added") {
      const lastRoomId = event.agent.lastRoomId;
      for (const ws of browsers) {
        if (canSeeRoom(getWsUser(ws), lastRoomId)) ws.send(JSON.stringify(event as ServerMessage));
      }
      return;
    }
    if (event.type === "killed_agent_removed") {
      for (const ws of browsers) {
        if (canSeeRoom(getWsUser(ws), event.lastRoomId)) ws.send(JSON.stringify(event as ServerMessage));
      }
      return;
    }
    if (
      event.type === "agent_removed" ||
      event.type === "room_created" ||
      event.type === "room_closed" ||
      event.type === "room_renamed" ||
      event.type === "room_settings_updated" ||
      event.type === "rooms_reordered"
    ) {
      for (const ws of browsers) sendInitialPayload(ws);
      return;
    }
    broadcast(event as ServerMessage);
  });

  // Wire CronjobManager events to WebSocket broadcasts.
  CronjobManager.onCronjobEvent((event) => {
    broadcast(event as ServerMessage);
  });
}
