import type { PresenceInfo, RoomWire, SessionWire, UserRecord } from "../../shared/types.ts";

export function UserSettingsRosterMeta({
  user,
  rooms,
  presences,
  sessions,
  showSessionStats,
}: {
  user: UserRecord;
  rooms: Pick<RoomWire, "id" | "name">[];
  presences: PresenceInfo[];
  sessions: SessionWire[];
  showSessionStats: boolean;
}) {
  const text = summarizeRosterUser(user, rooms, presences, sessions, showSessionStats);
  const online = presences.some((presence) => presence.userId === user.id);
  return (
    <span style={{ gridColumn: "1 / -1", display: "flex", alignItems: "center", gap: 5, minWidth: 0 }}>
      <span style={{ width: 6, height: 6, borderRadius: 999, background: online ? "var(--green)" : "var(--border)", flexShrink: 0 }} />
      <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: 10, color: "var(--text-hint)" }}>{text}</span>
    </span>
  );
}

export function summarizeRosterUser(
  user: UserRecord,
  rooms: Pick<RoomWire, "id" | "name">[],
  presences: Pick<PresenceInfo, "userId">[],
  sessions: Pick<SessionWire, "userId" | "lastSeenAt">[],
  showSessionStats: boolean,
): string {
  const roomText = summarizeRooms(user, rooms);
  const online = presences.some((presence) => presence.userId === user.id);
  if (user.pendingSignIn && !online) return `Never signed in • ${roomText}`;
  if (!showSessionStats) return online ? `Online • ${roomText}` : roomText;
  const userSessions = sessions.filter((session) => session.userId === user.id);
  if (online) return `${userSessions.length || 1} active • ${roomText}`;
  const lastSeenAt = Math.max(0, ...userSessions.map((session) => session.lastSeenAt));
  return lastSeenAt ? `Last seen ${formatRelative(lastSeenAt)} • ${roomText}` : `Offline • ${roomText}`;
}

function summarizeRooms(user: UserRecord, rooms: Pick<RoomWire, "id" | "name">[]): string {
  if (user.allowedRooms.length === rooms.length) return "All rooms";
  if (user.allowedRooms.length === 0) return "No rooms";
  const names = user.allowedRooms.map((id) => rooms.find((room) => room.id === id)?.name).filter(Boolean);
  return names.join(", ");
}

function formatRelative(ts: number): string {
  const minutes = Math.round((Date.now() - ts) / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}
