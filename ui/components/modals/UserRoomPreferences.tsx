import { useI18n } from "../../i18n.tsx";
import { useState, type Dispatch, type SetStateAction } from "react";
import type { UserRole } from "../../../shared/types.ts";
import { notificationPermission, requestNotificationPermission, type NotifPermission } from "../../notifications.ts";
import { dialogInput, dialogLabel } from "./dialog-styles.ts";

type RoomOption = { id: string; name: string };

type UserRoomPreferencesProps = {
  rooms: RoomOption[];
  canEditAccess: boolean;
  role: UserRole;
  setRole: Dispatch<SetStateAction<UserRole>>;
  allowedRooms: Set<string>;
  setAllowedRooms: Dispatch<SetStateAction<Set<string>>>;
  hiddenRooms: Set<string>;
  setHiddenRooms: Dispatch<SetStateAction<Set<string>>>;
  defaultRoomId: string | null;
  setDefaultRoomId: Dispatch<SetStateAction<string | null>>;
  notifRooms: Set<string>;
  setNotifRooms: Dispatch<SetStateAction<Set<string>>>;
};

export function UserRoomPreferences({
  rooms,
  canEditAccess,
  role,
  setRole,
  allowedRooms,
  setAllowedRooms,
  hiddenRooms,
  setHiddenRooms,
  defaultRoomId,
  setDefaultRoomId,
  notifRooms,
  setNotifRooms,
}: UserRoomPreferencesProps) {
  const { t } = useI18n();
  const allAllowed = allowedRooms.size === rooms.length;
  const shownRooms = rooms.filter((r) => allowedRooms.has(r.id) && !hiddenRooms.has(r.id));

  return (
    <>
      {canEditAccess && (
        <>
          <label style={{ ...dialogLabel, marginTop: 12 }}>{t("profile.role")}</label>
          <select aria-label={t("profile.role")} value={role} onChange={(e) => setRole(e.target.value as UserRole)} style={dialogInput}>
            <option value="owner">{t("settings.role.owner")}</option>
            <option value="member">{t("settings.role.member")}</option>
          </select>
          <label style={{ ...dialogLabel, marginTop: 12 }}>{t("profile.allowedRooms")}</label>
          <button type="button" style={smallBtn} onClick={() => setAllowedRooms(allAllowed ? new Set() : new Set(rooms.map((r) => r.id)))}>
            {allAllowed ? t("profile.clearAll") : t("profile.allowAll")}
          </button>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 6, marginTop: 8 }}>
            {rooms.map((room) => (
              <label key={room.id} style={{ display: "flex", gap: 7, alignItems: "center", fontSize: 12, color: "var(--text-primary)" }}>
                <input
                  type="checkbox"
                  checked={allowedRooms.has(room.id)}
                  onChange={(e) => {
                    const next = new Set(allowedRooms);
                    const nextHidden = new Set(hiddenRooms);
                    if (e.target.checked) next.add(room.id);
                    else {
                      next.delete(room.id);
                      nextHidden.delete(room.id);
                    }
                    setAllowedRooms(next);
                    setHiddenRooms(nextHidden);
                    if (!next.has(defaultRoomId ?? "")) setDefaultRoomId(next.values().next().value ?? null);
                    if (!e.target.checked && notifRooms.has(room.id)) {
                      const nextNotif = new Set(notifRooms);
                      nextNotif.delete(room.id);
                      setNotifRooms(nextNotif);
                    }
                  }}
                />
                {room.name}
              </label>
            ))}
          </div>
        </>
      )}
      <label style={{ ...dialogLabel, marginTop: 12 }}>{t("profile.shownRooms")}</label>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 6, marginTop: 8 }}>
        {rooms
          .filter((room) => allowedRooms.has(room.id))
          .map((room) => (
            <label key={room.id} style={{ display: "flex", gap: 7, alignItems: "center", fontSize: 12, color: "var(--text-primary)" }}>
              <input
                type="checkbox"
                checked={!hiddenRooms.has(room.id)}
                onChange={(e) => {
                  const nextHidden = new Set(hiddenRooms);
                  if (e.target.checked) nextHidden.delete(room.id);
                  else nextHidden.add(room.id);
                  setHiddenRooms(nextHidden);
                  if (!e.target.checked && defaultRoomId === room.id) {
                    const nextDefault = [...allowedRooms].find((id) => id !== room.id && !nextHidden.has(id)) ?? null;
                    setDefaultRoomId(nextDefault);
                  }
                  if (!e.target.checked && notifRooms.has(room.id)) {
                    const nextNotif = new Set(notifRooms);
                    nextNotif.delete(room.id);
                    setNotifRooms(nextNotif);
                  }
                }}
              />
              {room.name}
            </label>
          ))}
      </div>
      <label style={{ ...dialogLabel, marginTop: 12 }}>{t("profile.defaultRoom")}</label>
      <select aria-label={t("profile.defaultRoom")} value={defaultRoomId ?? ""} onChange={(e) => setDefaultRoomId(e.target.value || null)} style={dialogInput}>
        {[...allowedRooms]
          .filter((id) => !hiddenRooms.has(id))
          .map((id) => {
            const room = rooms.find((r) => r.id === id);
            return room ? (
              <option key={id} value={id}>
                {room.name}
              </option>
            ) : null;
          })}
      </select>
      <NotificationPrefs rooms={shownRooms} notifRooms={notifRooms} onChange={setNotifRooms} />
    </>
  );
}

function NotificationPrefs({ rooms, notifRooms, onChange }: { rooms: RoomOption[]; notifRooms: Set<string>; onChange: (next: Set<string>) => void }) {
  const { t } = useI18n();
  const [perm, setPerm] = useState<NotifPermission>(() => notificationPermission());
  const allOn = rooms.length > 0 && rooms.every((r) => notifRooms.has(r.id));

  function toggle(id: string, on: boolean) {
    const next = new Set(notifRooms);
    if (on) next.add(id);
    else next.delete(id);
    onChange(next);
  }

  async function enableDesktop() {
    setPerm(await requestNotificationPermission());
  }

  return (
    <>
      <label style={{ ...dialogLabel, marginTop: 12 }}>{t("profile.notify")}</label>
      <p style={{ fontSize: 10, color: "var(--text-ghost)", margin: "0 0 6px", lineHeight: 1.4 }}>{t("profile.notifyHint")}</p>
      {rooms.length === 0 ? (
        <div style={{ fontSize: 11, color: "var(--text-hint)" }}>{t("profile.noRoomsAvailable")}</div>
      ) : (
        <>
          <button type="button" style={smallBtn} onClick={() => onChange(allOn ? new Set() : new Set(rooms.map((r) => r.id)))}>
            {allOn ? t("profile.muteAll") : t("profile.notifyAll")}
          </button>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 6, marginTop: 8 }}>
            {rooms.map((room) => (
              <label key={room.id} style={{ display: "flex", gap: 7, alignItems: "center", fontSize: 12, color: "var(--text-primary)" }}>
                <input type="checkbox" checked={notifRooms.has(room.id)} onChange={(e) => toggle(room.id, e.target.checked)} />
                {room.name}
              </label>
            ))}
          </div>
        </>
      )}
      <div style={{ marginTop: 8, fontSize: 11, color: "var(--text-ghost)" }}>
        {perm === "unsupported" ? (
          t("profile.notificationsUnsupported")
        ) : perm === "granted" ? (
          t("profile.notificationsEnabled")
        ) : perm === "denied" ? (
          t("profile.notificationsDenied")
        ) : (
          <button type="button" style={smallBtn} onClick={enableDesktop}>
            {t("profile.enableNotifications")}
          </button>
        )}
      </div>
    </>
  );
}

const smallBtn: React.CSSProperties = {
  border: "1px solid var(--border)",
  background: "var(--btn-surface)",
  color: "var(--text-dim)",
  borderRadius: 7,
  padding: "5px 9px",
  fontSize: 11,
  cursor: "pointer",
};
