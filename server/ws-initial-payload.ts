import type { KilledAgentSummary, PresenceInfo, ServerMessage, UserRecord } from "../shared/types.ts";
import { KILLED_AGENT_CHIP_CAP } from "../shared/types.ts";
import * as AgentManager from "./agent-manager.ts";
import * as CronjobManager from "./cronjobs/index.ts";
import { loadRecentCwds } from "./persistence.ts";
import { listAllPresence } from "./presence.ts";
import { getUpdateStatus } from "./update-checker.ts";
import { canSeeRoom, getSessionContext, getWsUser, listUsers, projectAgents, projectRooms } from "./users.ts";
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
    const currentRoom = visibleIndexById.get(presence.currentRoomId);
    if (currentRoom === undefined) continue;
    entries.push({
      connectionId: presence.connectionId,
      userId: presence.userId,
      username: presence.username,
      device: presence.device,
      avatarColor: presence.avatarColor,
      avatarVariant: presence.avatarVariant,
      currentRoomId: presence.currentRoomId,
      currentRoom,
      focusedAgentId: presence.focusedAgentId,
      viewMode: presence.viewMode,
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
  ws.send(
    JSON.stringify({
      type: "full_state",
      agents: projectedAgents,
      recentCwds: loadRecentCwds(),
      office: AgentManager.getOfficeSettings(),
      rooms: projectedRooms,
      allRooms: user?.role === "owner" ? rooms : undefined,
      killedAgents: killedAgentsFor(ws),
    } as ServerMessage),
  );
  ws.send(JSON.stringify({ type: "users_list", users: usersForRecipient(user, rooms) } as ServerMessage));
  ws.send(JSON.stringify({ type: "session_context", context: getSessionContext(ws) } as ServerMessage));
  ws.send(JSON.stringify({ type: "tasks", tasks } as ServerMessage));
  ws.send(
    JSON.stringify({
      type: "cronjobs_state",
      cronjobs: CronjobManager.listCronjobs(),
      cronjobsPrompt: CronjobManager.getCronjobsPrompt(),
    } as ServerMessage),
  );
  const update = getUpdateStatus();
  if (update.updateAvailable) {
    ws.send(JSON.stringify({ type: "update_status", ...update } as ServerMessage));
  }
  for (const agent of projectedAgents) {
    const logs = AgentManager.getAgentLogs(agent.id);
    for (const entry of logs) {
      ws.send(JSON.stringify({ type: "log_entry", entry } as ServerMessage));
    }
    const cmds = AgentManager.getAgentCommands(agent.id);
    if (cmds.commands.length > 0 || cmds.skills.length > 0) {
      ws.send(JSON.stringify({ type: "slash_commands", agentId: agent.id, commands: cmds.commands, skills: cmds.skills } as ServerMessage));
    }
  }
  ws.send(JSON.stringify({ type: "presence_list", entries: buildPresenceListFor(ws), totalOnlineUsers: countTotalOnlineUsers() } as ServerMessage));
}
