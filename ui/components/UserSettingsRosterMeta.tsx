import { useI18n } from "../i18n.tsx";
import { translatorFor, type Translator } from "../../shared/i18n/translate.ts";
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
  const translator = useI18n();
  const text = summarizeRosterUser(user, rooms, presences, sessions, showSessionStats, translator);
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
  translator: Translator = translatorFor("en"),
): string {
  const { t, tn } = translator;
  const roomText = summarizeRooms(user, rooms, translator);
  const online = presences.some((presence) => presence.userId === user.id);
  if (user.pendingSignIn && !online) return t("profile.neverSignedIn", { rooms: roomText });
  if (!showSessionStats) return online ? t("profile.online", { rooms: roomText }) : roomText;
  const userSessions = sessions.filter((session) => session.userId === user.id);
  if (online) return tn("profile.active", userSessions.length || 1, { rooms: roomText });
  const lastSeenAt = Math.max(0, ...userSessions.map((session) => session.lastSeenAt));
  return lastSeenAt ? t("profile.lastSeen", { time: formatRelative(lastSeenAt, translator), rooms: roomText }) : t("profile.offline", { rooms: roomText });
}

function summarizeRooms(user: UserRecord, rooms: Pick<RoomWire, "id" | "name">[], { t }: Translator): string {
  if (user.allowedRooms.length === rooms.length) return t("profile.allRooms");
  if (user.allowedRooms.length === 0) return t("profile.noRooms");
  const names = user.allowedRooms.map((id) => rooms.find((room) => room.id === id)?.name).filter(Boolean);
  return names.join(", ");
}

function formatRelative(ts: number, { t }: Translator): string {
  const minutes = Math.round((Date.now() - ts) / 60000);
  if (minutes < 1) return t("profile.justNow");
  if (minutes < 60) return t("profile.minutesAgo", { count: minutes });
  const hours = Math.round(minutes / 60);
  if (hours < 48) return t("profile.hoursAgo", { count: hours });
  return t("profile.daysAgo", { count: Math.round(hours / 24) });
}
