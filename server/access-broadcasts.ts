import type { ServerWebSocket } from "bun";
import type { ServerMessage } from "../shared/types.ts";
import { listActiveSessions, listActiveSessionsForUserId, listInvites, listInvitesForUsername } from "./auth/auth.ts";
import { getWsUser } from "./users.ts";
import { browsers } from "./ws/broadcast.ts";

export function pushSessionsListToEachWs() {
  for (const browser of browsers) {
    sendSessionsListToWs(browser);
  }
}

export function pushInvitesListToEachWs() {
  for (const browser of browsers) {
    sendInvitesListToWs(browser);
  }
}

export function sendSessionsListToWs(ws: ServerWebSocket<unknown>) {
  const user = getWsUser(ws);
  if (!user) return;
  const sessions = user.role === "owner" ? listActiveSessions() : listActiveSessionsForUserId(user.id);
  ws.send(JSON.stringify({ type: "sessions_active_list", sessions } as ServerMessage));
}

export function sendInvitesListToWs(ws: ServerWebSocket<unknown>) {
  const user = getWsUser(ws);
  if (!user) return;
  const invites = user.role === "owner" ? listInvites() : listInvitesForUsername(user.name);
  ws.send(JSON.stringify({ type: "invites_list", invites } as ServerMessage));
}

export function broadcastToOwners(msg: ServerMessage) {
  const data = JSON.stringify(msg);
  for (const ws of browsers) {
    if (getWsUser(ws)?.role === "owner") ws.send(data);
  }
}
