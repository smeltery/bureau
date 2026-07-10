import { useEffect, useState } from "react";
import type { UserRecord, UserRole } from "../../../shared/types.ts";
import { GHOST_COLOR_PALETTE, GHOST_VARIANTS, type GhostVariant } from "../../../shared/avatar.ts";
import { GhostGraphic } from "../../office/ghostVariants.tsx";
import { addRawListener, removeRawListener, send } from "../../ws.ts";
import { notificationPermission, requestNotificationPermission, type NotifPermission } from "../../notifications.ts";
import { dialogCancelBtn, dialogInput, dialogLabel, dialogSaveBtn } from "./dialog-styles.ts";

type ValidationStatus = { kind: "idle" } | { kind: "pending" } | { kind: "ok"; keyCount?: number } | { kind: "error"; message: string };

export function UserEditPanel({
  user,
  rooms,
  canEditAccess,
  onClose,
  onDirtyChange,
}: {
  user: UserRecord;
  rooms: { id: string; name: string }[];
  canEditAccess: boolean;
  onClose: () => void;
  onDirtyChange?: (dirty: boolean) => void;
}) {
  const [name, setName] = useState(user.name);
  const [role, setRole] = useState<UserRole>(user.role);
  const [allowedRooms, setAllowedRooms] = useState(() => new Set(user.allowedRooms));
  const [hiddenRooms, setHiddenRooms] = useState(() => new Set(user.hidden ?? []));
  const [defaultRoomId, setDefaultRoomId] = useState<string | null>(user.defaultRoomId ?? user.allowedRooms[0] ?? rooms[0]?.id ?? null);
  const [notifRooms, setNotifRooms] = useState(() => new Set(user.notifRooms ?? []));
  const [envFile, setEnvFile] = useState(user.envFile ?? "");
  const [memberPrompt, setMemberPrompt] = useState(user.memberPrompt ?? "");
  const [avatarColor, setAvatarColor] = useState(user.avatarColor);
  const [avatarVariant, setAvatarVariant] = useState<GhostVariant>(user.avatarVariant);
  const [envStatus, setEnvStatus] = useState<ValidationStatus>({ kind: "idle" });
  const allAllowed = allowedRooms.size === rooms.length;
  const userNotif = user.notifRooms ?? [];
  const userHidden = user.hidden ?? [];

  const isDirty =
    name !== user.name ||
    role !== user.role ||
    envFile !== (user.envFile ?? "") ||
    memberPrompt !== (user.memberPrompt ?? "") ||
    avatarColor !== user.avatarColor ||
    avatarVariant !== user.avatarVariant ||
    (defaultRoomId ?? null) !== (user.defaultRoomId ?? null) ||
    allowedRooms.size !== user.allowedRooms.length ||
    user.allowedRooms.some((id) => !allowedRooms.has(id)) ||
    hiddenRooms.size !== userHidden.length ||
    userHidden.some((id) => !hiddenRooms.has(id)) ||
    notifRooms.size !== userNotif.length ||
    userNotif.some((id) => !notifRooms.has(id));

  useEffect(() => {
    onDirtyChange?.(isDirty);
    return () => onDirtyChange?.(false);
  }, [isDirty, onDirtyChange]);

  function save() {
    const shownRooms = [...allowedRooms].filter((id) => !hiddenRooms.has(id));
    const notif = [...notifRooms].filter((id) => shownRooms.includes(id));
    send({
      type: "update_user",
      userId: user.id,
      changes: {
        name: name.trim(),
        role,
        allowedRooms: [...allowedRooms],
        hidden: [...hiddenRooms].filter((id) => allowedRooms.has(id)),
        order: (user.order ?? []).filter((id) => allowedRooms.has(id)),
        defaultRoomId,
        notifRooms: notif,
        envFile: envFile.trim() || null,
        memberPrompt: memberPrompt.trim() || null,
        avatarColor,
        avatarVariant,
      },
    });
    onClose();
  }

  function cancel() {
    if (isDirty && !window.confirm("Discard unsaved changes?")) return;
    onClose();
  }

  function validateEnv() {
    const reqId = `user-env-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    setEnvStatus({ kind: "pending" });
    const listener = (data: string) => {
      try {
        const msg = JSON.parse(data);
        if (msg.type === "settings_validation" && msg.requestId === reqId) {
          if (msg.ok) setEnvStatus({ kind: "ok", keyCount: msg.keyCount });
          else setEnvStatus({ kind: "error", message: msg.error || "Invalid env file" });
          removeRawListener(listener);
        }
      } catch {}
    };
    addRawListener(listener);
    send({
      type: "request_settings_validation",
      requestId: reqId,
      scope: "user",
      userId: user.id,
      envFile: envFile.trim() || null,
    });
  }

  return (
    <div style={{ padding: "0 12px 12px 12px" }}>
      <label style={dialogLabel}>Display name</label>
      <input value={name} onChange={(e) => setName(e.target.value)} style={dialogInput} />
      <label style={{ ...dialogLabel, marginTop: 12 }}>Avatar</label>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: 8 }}>
        {GHOST_VARIANTS.map((variant) => (
          <button
            key={variant}
            type="button"
            onClick={() => setAvatarVariant(variant)}
            title={variant}
            style={{
              height: 58,
              border: `1px solid ${avatarVariant === variant ? "var(--accent)" : "var(--border)"}`,
              background: avatarVariant === variant ? "var(--bg-hover)" : "var(--btn-surface)",
              borderRadius: 8,
              cursor: "pointer",
            }}
          >
            <GhostGraphic variant={variant} color={avatarColor} size={28} />
          </button>
        ))}
      </div>
      <label style={{ ...dialogLabel, marginTop: 12 }}>Avatar color</label>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
        {GHOST_COLOR_PALETTE.map((color) => (
          <button
            key={color}
            type="button"
            onClick={() => setAvatarColor(color)}
            title={color}
            style={{
              width: 24,
              height: 24,
              borderRadius: 999,
              border: `2px solid ${avatarColor.toLowerCase() === color ? "var(--text-primary)" : "var(--border)"}`,
              background: color,
              cursor: "pointer",
            }}
          />
        ))}
        <input value={avatarColor} onChange={(e) => setAvatarColor(e.target.value.slice(0, 7))} style={{ ...dialogInput, width: 98, height: 28, padding: "4px 8px" }} />
      </div>
      {canEditAccess && (
        <>
          <label style={{ ...dialogLabel, marginTop: 12 }}>Role</label>
          <select value={role} onChange={(e) => setRole(e.target.value as UserRole)} style={dialogInput}>
            <option value="owner">Owner</option>
            <option value="member">Member</option>
          </select>
          <label style={{ ...dialogLabel, marginTop: 12 }}>Allowed rooms</label>
          <button type="button" style={smallBtn} onClick={() => setAllowedRooms(allAllowed ? new Set() : new Set(rooms.map((r) => r.id)))}>
            {allAllowed ? "Clear all" : "Allow all"}
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
      <label style={{ ...dialogLabel, marginTop: 12 }}>Shown rooms</label>
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
      <label style={{ ...dialogLabel, marginTop: 12 }}>Default room</label>
      <select value={defaultRoomId ?? ""} onChange={(e) => setDefaultRoomId(e.target.value || null)} style={dialogInput}>
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
      <NotificationPrefs rooms={rooms.filter((r) => allowedRooms.has(r.id) && !hiddenRooms.has(r.id))} notifRooms={notifRooms} onChange={setNotifRooms} />
      <label style={{ ...dialogLabel, marginTop: 12 }}>Env file path</label>
      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <input
          value={envFile}
          onChange={(e) => {
            setEnvFile(e.target.value);
            setEnvStatus({ kind: "idle" });
          }}
          placeholder="/absolute/path/to/.env"
          style={{ ...dialogInput, flex: 1 }}
        />
        <button type="button" style={{ ...smallBtn, height: 30 }} onClick={validateEnv} disabled={envStatus.kind === "pending"}>
          {envStatus.kind === "pending" ? "Checking..." : "Validate"}
        </button>
      </div>
      <ValidationLine status={envStatus} />
      <label style={{ ...dialogLabel, marginTop: 12 }}>Personal context</label>
      <textarea
        value={memberPrompt}
        onChange={(e) => setMemberPrompt(e.target.value)}
        rows={4}
        placeholder="Context injected into agents you own"
        style={{ ...dialogInput, resize: "vertical", minHeight: 86 }}
      />
      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 12 }}>
        <button style={dialogCancelBtn} onClick={cancel}>
          Cancel
        </button>
        <button style={dialogSaveBtn} onClick={save}>
          Save
        </button>
      </div>
    </div>
  );
}

function ValidationLine({ status }: { status: ValidationStatus }) {
  if (status.kind === "idle") return null;
  if (status.kind === "pending") return <p style={{ fontSize: 10, color: "var(--text-ghost)", margin: "4px 0 0" }}>Checking...</p>;
  if (status.kind === "ok") {
    if (status.keyCount === undefined) return <p style={{ fontSize: 10, color: "var(--accent)", margin: "4px 0 0" }}>No env file configured.</p>;
    return (
      <p style={{ fontSize: 10, color: "var(--accent)", margin: "4px 0 0" }}>
        Loaded {status.keyCount} variable{status.keyCount === 1 ? "" : "s"}.
      </p>
    );
  }
  return <p style={{ fontSize: 10, color: "#ff6b6b", margin: "4px 0 0" }}>{status.message}</p>;
}

function NotificationPrefs({ rooms, notifRooms, onChange }: { rooms: { id: string; name: string }[]; notifRooms: Set<string>; onChange: (next: Set<string>) => void }) {
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
      <label style={{ ...dialogLabel, marginTop: 12 }}>Notify me about</label>
      <p style={{ fontSize: 10, color: "var(--text-ghost)", margin: "0 0 6px", lineHeight: 1.4 }}>
        Play a sound and (if enabled) show a desktop alert when an agent in these rooms finishes while this tab is in the background.
      </p>
      {rooms.length === 0 ? (
        <div style={{ fontSize: 11, color: "var(--text-hint)" }}>No rooms available.</div>
      ) : (
        <>
          <button type="button" style={smallBtn} onClick={() => onChange(allOn ? new Set() : new Set(rooms.map((r) => r.id)))}>
            {allOn ? "Mute all" : "Notify for all"}
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
          "Desktop notifications aren't supported in this browser."
        ) : perm === "granted" ? (
          "Desktop notifications enabled."
        ) : perm === "denied" ? (
          "Desktop notifications blocked — re-enable them in your browser's site settings."
        ) : (
          <button type="button" style={smallBtn} onClick={enableDesktop}>
            Enable desktop notifications
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
