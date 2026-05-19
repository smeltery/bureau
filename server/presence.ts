import type { GhostVariant } from "../shared/avatar.ts";

export interface PresenceState {
  connectionId: string;
  userId: string;
  username: string;
  device: string | null;
  avatarColor: string;
  avatarVariant: GhostVariant;
  currentRoomId: string | null;
  focusedAgentId: string | null;
  viewMode: "office" | "log" | "away";
  lastSeenAt: number;
}

const presences = new Map<string, PresenceState>();

export function setPresence(state: PresenceState): boolean {
  const existing = presences.get(state.connectionId);
  presences.set(state.connectionId, state);
  if (!existing) return true;
  return (
    existing.username !== state.username ||
    existing.device !== state.device ||
    existing.avatarColor !== state.avatarColor ||
    existing.avatarVariant !== state.avatarVariant ||
    existing.currentRoomId !== state.currentRoomId ||
    existing.focusedAgentId !== state.focusedAgentId ||
    existing.viewMode !== state.viewMode
  );
}

export function removePresence(connectionId: string): boolean {
  return presences.delete(connectionId);
}

export function listAllPresence(): PresenceState[] {
  return [...presences.values()];
}

export function refreshPresenceForUser(userId: string, display: { name: string; avatarColor: string; avatarVariant: GhostVariant }, allowedRoomIds?: ReadonlySet<string>): boolean {
  let changed = false;
  for (const [connectionId, presence] of presences) {
    if (presence.userId !== userId) continue;
    let next = presence;
    if (presence.username !== display.name || presence.avatarColor !== display.avatarColor || presence.avatarVariant !== display.avatarVariant) {
      next = { ...next, username: display.name, avatarColor: display.avatarColor, avatarVariant: display.avatarVariant };
      changed = true;
    }
    if (allowedRoomIds && next.currentRoomId && !allowedRoomIds.has(next.currentRoomId)) {
      next = { ...next, currentRoomId: null, focusedAgentId: null, lastSeenAt: Date.now() };
      changed = true;
    }
    if (next !== presence) presences.set(connectionId, next);
  }
  return changed;
}
