import type { GhostVariant } from "../shared/avatar.ts";
import { LOBBY_ROOM_ID, LOBBY_SPOT_IDS } from "../shared/lobby.ts";

// Pure lobby seat assignment. Geometry stays in the scene; the server only
// reserves stable spot ids, one per connection. A null spot is overflow.
export interface LobbyAssignment {
  connectionId: string;
  lobbySpotId: string | null;
}

export function assignLobbySpot(presences: readonly LobbyAssignment[], spotIds: readonly string[], connectionId: string, random: () => number): LobbyAssignment {
  const occupied = new Set(presences.map((p) => p.lobbySpotId));
  const free = spotIds.filter((id) => !occupied.has(id));
  return {
    connectionId,
    lobbySpotId: free.length > 0 ? free[Math.floor(random() * free.length)] : null,
  };
}

export function pickLobbySpot(presences: readonly LobbyAssignment[], spotIds: readonly string[], connectionId: string, spotId: string): LobbyAssignment[] {
  if (!spotIds.includes(spotId) || presences.some((p) => p.lobbySpotId === spotId)) return [...presences];
  return presences.map((p) => (p.connectionId === connectionId ? { ...p, lobbySpotId: spotId } : p));
}

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
  lobbySpotId?: string | null;
}

const presences = new Map<string, PresenceState>();

export function setPresence(state: PresenceState, random = Math.random): boolean {
  const existing = presences.get(state.connectionId);
  if (state.currentRoomId === LOBBY_ROOM_ID) {
    if (existing?.currentRoomId === LOBBY_ROOM_ID && state.lobbySpotId === undefined) {
      state = { ...state, lobbySpotId: existing.lobbySpotId };
    } else if (state.lobbySpotId === undefined) {
      const next = assignLobbySpot(lobbyAssignments(), LOBBY_SPOT_IDS, state.connectionId, random);
      state = { ...state, ...next };
    }
  } else {
    state = { ...state, lobbySpotId: undefined };
  }
  presences.set(state.connectionId, state);
  if (!existing) return true;
  return (
    existing.username !== state.username ||
    existing.device !== state.device ||
    existing.avatarColor !== state.avatarColor ||
    existing.avatarVariant !== state.avatarVariant ||
    existing.currentRoomId !== state.currentRoomId ||
    existing.focusedAgentId !== state.focusedAgentId ||
    existing.viewMode !== state.viewMode ||
    existing.lobbySpotId !== state.lobbySpotId
  );
}

export function removePresence(connectionId: string): boolean {
  return presences.delete(connectionId);
}

export function getPresence(connectionId: string): PresenceState | undefined {
  return presences.get(connectionId);
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
    if (allowedRoomIds && next.currentRoomId && next.currentRoomId !== LOBBY_ROOM_ID && !allowedRoomIds.has(next.currentRoomId)) {
      next = { ...next, currentRoomId: null, focusedAgentId: null, lastSeenAt: Date.now(), lobbySpotId: undefined };
      changed = true;
    }
    if (next !== presence) presences.set(connectionId, next);
  }
  return changed;
}

function lobbyAssignments(): LobbyAssignment[] {
  return listAllPresence()
    .filter((p) => p.currentRoomId === LOBBY_ROOM_ID)
    .map((p) => ({
      connectionId: p.connectionId,
      lobbySpotId: p.lobbySpotId ?? null,
    }));
}

function applyLobbyAssignments(rows: LobbyAssignment[]): boolean {
  let changed = false;
  for (const row of rows) {
    const current = presences.get(row.connectionId);
    if (!current) continue;
    if (setPresence({ ...current, ...row })) changed = true;
  }
  return changed;
}

export function moveLobbyPresence(connectionId: string, spotId: string): boolean {
  return applyLobbyAssignments(pickLobbySpot(lobbyAssignments(), LOBBY_SPOT_IDS, connectionId, spotId));
}
