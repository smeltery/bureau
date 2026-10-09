import { replayOfficeFrames } from "./ws/outbox/sockets.ts";
import type { KilledAgentSummary, PresenceInfo, ServerMessage, UserRecord } from "../shared/types.ts";
import { KILLED_AGENT_CHIP_CAP, LOBBY_ROOM_ID } from "../shared/types.ts";
import * as AgentManager from "./agent-manager.ts";
import { scheduleStateFrames } from "./ws/cronjob-events.ts";
import { loadRecentCwds } from "./persistence.ts";
import { listAllPresence } from "./presence.ts";
import { getUpdateStatus } from "./update-checker.ts";
import { canSeeRoom, getSessionContext, getWsUser, listUsers, projectAgents, projectRooms } from "./users.ts";
import { listAccessibleRooms } from "./user-room-projection.ts";
import { browsers, tasks } from "./ws/broadcast.ts";

function killedAgentsFor(ws: import("bun").ServerWebSocket<unknown>): KilledAgentSummary[] {
  const user = getWsUser(ws);
  return AgentManager.getKilledAgentSummaries()
    .filter((k) => canSeeRoom(user, k.lastRoomId))
    .slice(0, KILLED_AGENT_CHIP_CAP);
}

function usersForRecipient(recipient: ReturnType<typeof getWsUser>, rooms: ReturnType<typeof AgentManager.getRooms>): UserRecord[] {
  const users = listUsers(rooms);
  if (!recipient || recipient.role === "owner") return users;
  return users.map((listed) => (listed.id === recipient.id ? listed : { ...listed, envFile: null, memberPrompt: null, hidden: [], order: [] }));
}

function buildPresenceListFor(ws: import("bun").ServerWebSocket<unknown>): PresenceInfo[] {
  const user = getWsUser(ws);
  const rooms = AgentManager.getRooms();
  const projectedRooms = projectRooms(user, rooms);
  const visibleIndexById = new Map(projectedRooms.map((room, index) => [room.id, index]));
  const entries: PresenceInfo[] = [];
  for (const presence of listAllPresence()) {
    if (!presence.currentRoomId) continue;
    const inLobby = presence.currentRoomId === LOBBY_ROOM_ID;
    const currentRoom = inLobby ? null : visibleIndexById.get(presence.currentRoomId);
    if (!inLobby && currentRoom === undefined) continue;
    entries.push({
      connectionId: presence.connectionId,
      userId: presence.userId,
      username: presence.username,
      device: presence.device,
      avatarColor: presence.avatarColor,
      avatarVariant: presence.avatarVariant,
      currentRoomId: presence.currentRoomId,
      currentRoom: currentRoom ?? null,
      focusedAgentId: presence.focusedAgentId,
      viewMode: presence.viewMode,
      ...(inLobby ? { lobbySpotId: presence.lobbySpotId ?? null } : {}),
    });
  }
  entries.sort((a, b) => a.connectionId.localeCompare(b.connectionId));
  return entries;
}

function countTotalOnlineUsers(): number {
  return new Set(listAllPresence().map((presence) => presence.userId)).size;
}

export function pushPresenceListToEachWs() {
  for (const ws of browsers) {
    ws.send(JSON.stringify({ type: "presence_list", entries: buildPresenceListFor(ws), totalOnlineUsers: countTotalOnlineUsers() } as ServerMessage));
  }
}

export function sendInitialPayload(ws: import("bun").ServerWebSocket<unknown>) {
  const user = getWsUser(ws);
  const rooms = AgentManager.getRooms();
  const agents = AgentManager.getAllAgents();
  const projectedRooms = projectRooms(user, rooms);
  const projectedAgents = projectAgents(user, agents, rooms);
  const histories = projectedAgents.map((agent) => {
    const logs = AgentManager.getAgentLogs(agent.id);
    return { agent, logs, length: logs.length, commands: AgentManager.getAgentCommands(agent.id) };
  });
  const schedules = scheduleStateFrames(ws);
  const users = usersForRecipient(user, rooms);
  const context = getSessionContext(ws);
  const frames = (function* () {
    yield JSON.stringify({
      type: "full_state",
      agents: projectedAgents,
      recentCwds: loadRecentCwds(),
      office: AgentManager.getOfficeSettings(),
      rooms: projectedRooms,
      allRooms: user ? listAccessibleRooms(user, rooms) : undefined,
      killedAgents: killedAgentsFor(ws),
    } as ServerMessage);
    yield JSON.stringify({ type: "users_list", users } as ServerMessage);
    yield JSON.stringify({ type: "session_context", context } as ServerMessage);
    yield JSON.stringify({ type: "tasks", tasks } as ServerMessage);
    yield* schedules;
    const update = getUpdateStatus();
    if (update.updateAvailable) {
      yield JSON.stringify({ type: "update_status", ...update } as ServerMessage);
    }
    for (const { agent, logs, length, commands: cmds } of histories) {
      for (let index = 0; index < length; index++) {
        yield JSON.stringify({ type: "log_entry", entry: logs[index]! } as ServerMessage);
      }
      if (cmds.commands.length > 0 || cmds.skills.length > 0) {
        yield JSON.stringify({ type: "slash_commands", agentId: agent.id, commands: cmds.commands, skills: cmds.skills } as ServerMessage);
      }
    }
    // Fence the burst: everything cached has now been replayed, so the client can
    // swap the whole transcript in at once instead of guessing when the frames
    // stopped. Sent even when nothing was replayed — "the replay is empty" is
    // exactly the case a client cannot infer.
    yield JSON.stringify({ type: "log_replay_complete" } as ServerMessage);
    yield JSON.stringify({ type: "presence_list", entries: buildPresenceListFor(ws), totalOnlineUsers: countTotalOnlineUsers() } as ServerMessage);
  })();
  replayOfficeFrames(ws, frames);
}
