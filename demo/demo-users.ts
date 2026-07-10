import type { OfficeState } from "../shared/office-state.ts";
import type { PresenceInfo, SessionContext, SessionWire, UserRecord } from "../shared/types.ts";
import { defaultGhostColorForUserId, isGhostVariant, isHexColor, normalizeHexColor } from "../shared/avatar.ts";
import { shimEmit } from "../ui/ws.ts";

const users = new Map<string, UserRecord>();
let sessionContext: SessionContext | null = null;
let activeSessions: SessionWire[] = [];
let demoPresenceAgentIndex = 0;
let demoPresenceTimer: ReturnType<typeof setInterval> | null = null;
let currentDemoPresence: PresenceInfo | null = null;

export function demoUsers(): UserRecord[] {
  return [...users.values()];
}

export function demoSessionContext(): SessionContext | null {
  return sessionContext;
}

export function seedUsers(state: OfficeState) {
  if (users.size > 0) return;
  const roomIds = state.getState().rooms.map((r) => r.id);
  const now = Date.now();
  const ricky: UserRecord = { id: "demo-ricky", name: "Ricky", role: "owner", allowedRooms: roomIds, defaultRoomId: roomIds[0] ?? null, avatarColor: defaultGhostColorForUserId("demo-ricky"), avatarVariant: "classic", createdAt: now - 7 * 86400000 };
  const stephen: UserRecord = { id: "demo-stephen", name: "Stephen", role: "member", allowedRooms: roomIds.slice(0, 1), defaultRoomId: roomIds[0] ?? null, avatarColor: defaultGhostColorForUserId("demo-stephen"), avatarVariant: "stubby-arms", createdAt: now - 5 * 86400000 };
  users.set("ricky", ricky);
  users.set("stephen", stephen);
  sessionContext = { userId: ricky.id, username: ricky.name, role: ricky.role, currentSessionPrefix: "a1b2c3d4", connectionId: "a1b2c3d4" };
  activeSessions = [
    { sessionPrefix: "a1b2c3d4", username: "Ricky", createdAt: now - 7 * 86400000, lastSeenAt: now - 30_000, expiresAt: now + 30 * 86400000, absoluteExpiresAt: now + 365 * 86400000 },
    { sessionPrefix: "7e9f0a12", username: "Ricky", createdAt: now - 3 * 86400000, lastSeenAt: now - 2 * 3600000, expiresAt: now + 30 * 86400000, absoluteExpiresAt: now + 365 * 86400000 },
    { sessionPrefix: "9f8e7d6c", username: "Stephen", createdAt: now - 5 * 86400000, lastSeenAt: now - 15 * 60_000, expiresAt: now + 30 * 86400000, absoluteExpiresAt: now + 365 * 86400000 },
  ];
}

export function emitDemoPresence(state: OfficeState, currentRoom: number | null, focusedAgentId: string | null, viewMode: "office" | "log" | "away", device: string | null = null) {
  const entries: PresenceInfo[] = [];
  if (sessionContext) {
    const me = [...users.values()].find((u) => u.id === sessionContext?.userId);
    if (me) {
      currentDemoPresence = { connectionId: sessionContext.connectionId, userId: me.id, username: me.name, device, avatarColor: me.avatarColor, avatarVariant: me.avatarVariant, currentRoom, focusedAgentId, viewMode };
      entries.push(currentDemoPresence);
    }
  } else {
    currentDemoPresence = null;
  }
  const stephenPresence = getStephenPhonePresence(state);
  if (stephenPresence) entries.push(stephenPresence);
  shimEmit({ type: "presence_list", entries, totalOnlineUsers: countDemoOnlineUsers(entries) });
}

export function emitCurrentDemoPresence(state: OfficeState) {
  const entries: PresenceInfo[] = [];
  if (currentDemoPresence) entries.push(currentDemoPresence);
  const stephenPresence = getStephenPhonePresence(state);
  if (stephenPresence) entries.push(stephenPresence);
  shimEmit({ type: "presence_list", entries, totalOnlineUsers: countDemoOnlineUsers(entries) });
}

export function startDemoPresenceCycle(state: OfficeState) {
  if (demoPresenceTimer) return;
  demoPresenceTimer = setInterval(() => {
    const roomZeroAgents = state.getState().agents.filter((a) => a.room === 0);
    if (roomZeroAgents.length === 0) return;
    demoPresenceAgentIndex = (demoPresenceAgentIndex + 1) % roomZeroAgents.length;
    emitCurrentDemoPresence(state);
  }, 4000);
}

export function claimDemoUser(username: string) {
  const user = users.get(username.trim().toLocaleLowerCase());
  if (user) sessionContext = { userId: user.id, username: user.name, role: user.role, currentSessionPrefix: user.name === "Ricky" ? "a1b2c3d4" : "9f8e7d6c", connectionId: user.name === "Ricky" ? "a1b2c3d4" : "9f8e7d6c" };
  shimEmit({ type: "session_context", context: sessionContext });
  shimEmit({ type: "users_list", users: demoUsers() });
}

export function updateDemoUser(state: OfficeState, userId: string, changes: Partial<Pick<UserRecord, "name" | "role" | "allowedRooms" | "defaultRoomId" | "avatarColor" | "avatarVariant">>) {
  const existing = [...users.values()].find((u) => u.id === userId);
  let updated: UserRecord | null = null;
  if (existing) {
    const next: UserRecord = {
      ...existing,
      name: changes.name?.trim() || existing.name,
      role: changes.role ?? existing.role,
      allowedRooms: changes.allowedRooms ?? existing.allowedRooms,
      defaultRoomId: changes.defaultRoomId === undefined ? existing.defaultRoomId : changes.defaultRoomId,
      avatarColor: changes.avatarColor && isHexColor(changes.avatarColor) ? normalizeHexColor(changes.avatarColor) : existing.avatarColor,
      avatarVariant: changes.avatarVariant && isGhostVariant(changes.avatarVariant) ? changes.avatarVariant : existing.avatarVariant,
    };
    users.delete(existing.name.toLocaleLowerCase());
    users.set(next.name.toLocaleLowerCase(), next);
    updated = next;
  }
  shimEmit({ type: "users_list", users: demoUsers() });
  if (updated?.name === "Stephen") emitCurrentDemoPresence(state);
}

export function deleteDemoUser(userId: string) {
  const existing = [...users.values()].find((u) => u.id === userId);
  if (existing) users.delete(existing.name.toLocaleLowerCase());
  shimEmit({ type: "users_list", users: demoUsers() });
}

export function listDemoActiveSessions() {
  shimEmit({ type: "sessions_active_list", sessions: [...activeSessions] });
}

export function revokeDemoSession(sessionPrefix: string) {
  activeSessions = activeSessions.filter((s) => s.sessionPrefix !== sessionPrefix);
  shimEmit({ type: "sessions_active_list", sessions: [...activeSessions] });
}

export function logoutDemoSession(state: OfficeState) {
  sessionContext = null;
  shimEmit({ type: "session_context", context: null });
  emitDemoPresence(state, null, null, "away");
}

function getStephenPhonePresence(state: OfficeState): PresenceInfo | null {
  const stephen = users.get("stephen");
  const roomZeroAgents = state.getState().agents.filter((a) => a.room === 0);
  const stephenAgent = roomZeroAgents[demoPresenceAgentIndex % Math.max(1, roomZeroAgents.length)];
  if (!stephen || !stephenAgent) return null;
  return { connectionId: "demo-stephen-phone", userId: stephen.id, username: stephen.name, device: "Phone", avatarColor: stephen.avatarColor, avatarVariant: stephen.avatarVariant, currentRoom: 0, focusedAgentId: stephenAgent.id, viewMode: "log" };
}

function countDemoOnlineUsers(entries: PresenceInfo[]): number {
  return new Set(entries.map((entry) => entry.userId)).size;
}
