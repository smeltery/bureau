import { useEffect, useMemo, useRef, useState } from "react";
import { useAppState } from "../../store.tsx";
import { send } from "../../ws.ts";
import type { UserRecord, UserRole } from "../../../shared/types.ts";
import { GHOST_COLOR_PALETTE, GHOST_VARIANTS, type GhostVariant } from "../../../shared/avatar.ts";
import { GhostGraphic } from "../../office/ghostVariants.tsx";
import { Modal } from "./Modal.tsx";
import { dialogCancelBtn, dialogInput, dialogLabel, dialogSaveBtn } from "./dialog-styles.ts";
import { AccessPane } from "../AccessPane.tsx";
import { MyDevicesPane } from "../MyDevicesPane.tsx";
import { notificationPermission, requestNotificationPermission, type NotifPermission } from "../../notifications.ts";

export function UserManagementModal({
  currentUsername,
  forceCreate,
  initialUserId,
  onSwitchUser,
  onClose,
}: {
  currentUsername: string | null;
  forceCreate: boolean;
  initialUserId?: string | null;
  onSwitchUser: (name: string) => void;
  onClose?: () => void;
}) {
  const { users, rooms, allRooms, sessionContext } = useAppState();
  const [newName, setNewName] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const isOwner = sessionContext?.role === "owner";
  const userList = useMemo(() => [...users.values()].sort((a, b) => a.name.localeCompare(b.name)), [users]);
  const editorRooms = allRooms.length ? allRooms : rooms;
  const dismissable = !forceCreate && !!onClose;

  // Set by the open edit panel when its form is dirty; used to gate
  // backdrop/Close so in-flight edits don't vanish silently.
  const editIsDirtyRef = useRef(false);
  function requestClose() {
    if (editIsDirtyRef.current && !window.confirm("Discard unsaved changes?")) return;
    onClose?.();
  }

  useEffect(() => {
    if (initialUserId) setEditingId(initialUserId);
  }, [initialUserId]);

  function switchUser(name: string) {
    localStorage.setItem("bureau-username", name);
    onSwitchUser(name);
    send({ type: "claim_user", username: name });
    if (dismissable) onClose?.();
  }

  function createUser() {
    const name = newName.trim();
    if (!name) return;
    switchUser(name);
    setNewName("");
  }

  return (
    <Modal onClose={dismissable ? requestClose : () => {}} width={680} allowBackdropClose={dismissable}>
      <h3 style={{ fontSize: 17, fontWeight: 700, margin: 0, color: "var(--text-primary)" }}>{forceCreate ? "Welcome - pick or create a user" : "User Settings"}</h3>
      <p style={{ fontSize: 11, color: "var(--text-ghost)", margin: "6px 0 0", lineHeight: 1.4 }}>Profiles live on the server. Owners can set which rooms each member can see and use.</p>

      {userList.length > 0 && (
        <>
          <div style={{ ...dialogLabel, marginTop: 18 }}>Users</div>
          <div style={{ border: "1px solid var(--border)", borderRadius: 8, overflow: "hidden" }}>
            {userList.map((u) => {
              const isMe = sessionContext ? sessionContext.userId === u.id : currentUsername?.toLocaleLowerCase() === u.name.toLocaleLowerCase();
              const isEditing = editingId === u.id;
              return (
                <div key={u.id} style={{ borderBottom: "1px solid var(--border-subtle)", background: isMe ? "var(--bg-hover)" : "transparent" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 12px" }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8, color: "var(--text-primary)", fontSize: 13, fontWeight: 650 }}>
                        <span>
                          {u.name}
                          {isMe ? " (you)" : ""}
                        </span>
                        <RoleBadge role={u.role} />
                      </div>
                      <div style={{ marginTop: 2, fontSize: 10, color: "var(--text-hint)", fontFamily: "'JetBrains Mono',monospace" }}>{summarizeUser(u, editorRooms)}</div>
                    </div>
                    {!isMe && (
                      <button style={smallBtn} onClick={() => switchUser(u.name)}>
                        Use
                      </button>
                    )}
                    {(isOwner || isMe) && (
                      <button style={smallBtn} onClick={() => setEditingId(isEditing ? null : u.id)}>
                        {isEditing ? "Close" : "Edit"}
                      </button>
                    )}
                  </div>
                  {isEditing && (
                    <UserEditPanel
                      user={u}
                      rooms={editorRooms}
                      canEditAccess={isOwner}
                      onClose={() => setEditingId(null)}
                      onDirtyChange={(d) => {
                        editIsDirtyRef.current = d;
                      }}
                    />
                  )}
                </div>
              );
            })}
          </div>
        </>
      )}

      <div style={{ ...dialogLabel, marginTop: 18 }}>Create or claim user</div>
      <div style={{ display: "flex", gap: 8 }}>
        <input
          value={newName}
          onChange={(e) => setNewName(e.target.value.slice(0, 64))}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.nativeEvent.isComposing) createUser();
          }}
          placeholder="Username"
          style={dialogInput}
        />
        <button onClick={createUser} style={{ ...dialogSaveBtn, flexShrink: 0 }}>
          Use
        </button>
      </div>

      {isOwner ? <AccessPane /> : sessionContext && <MyDevicesPane />}

      {sessionContext && (
        <div style={{ marginTop: 22 }}>
          <h4 style={{ fontSize: 13, margin: 0, color: "var(--text-primary)" }}>Sign out</h4>
          <p style={{ fontSize: 11, margin: "5px 0 8px", color: "var(--text-ghost)" }}>Sign out of this device. Other devices for the same user stay signed in.</p>
          {/* HTML form POST so the browser sends the cookie and the server's
              /auth/logout handler can apply the lockout-prevention check
              before clearing it. The WS-side logout sets session_context to
              null on success but doesn't itself clear the cookie. */}
          <form method="POST" action="/auth/logout" style={{ margin: 0 }}>
            <button type="submit" style={signOutBtn}>
              Sign out
            </button>
          </form>
        </div>
      )}

      {dismissable && (
        <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 18 }}>
          <button onClick={requestClose} style={dialogCancelBtn}>
            Close
          </button>
        </div>
      )}
    </Modal>
  );
}

const signOutBtn: React.CSSProperties = {
  padding: "6px 14px",
  borderRadius: 7,
  border: "1px solid var(--border)",
  background: "var(--btn-surface)",
  color: "var(--text-primary)",
  fontSize: 12,
  cursor: "pointer",
};

function UserEditPanel({
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
  const [defaultRoomId, setDefaultRoomId] = useState<string | null>(user.defaultRoomId ?? user.allowedRooms[0] ?? rooms[0]?.id ?? null);
  const [notifRooms, setNotifRooms] = useState(() => new Set(user.notifRooms ?? []));
  const [envFile, setEnvFile] = useState(user.envFile ?? "");
  const [memberPrompt, setMemberPrompt] = useState(user.memberPrompt ?? "");
  const [avatarColor, setAvatarColor] = useState(user.avatarColor);
  const [avatarVariant, setAvatarVariant] = useState<GhostVariant>(user.avatarVariant);
  const allAllowed = allowedRooms.size === rooms.length;
  const userNotif = user.notifRooms ?? [];

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
    notifRooms.size !== userNotif.length ||
    userNotif.some((id) => !notifRooms.has(id));
  useEffect(() => {
    onDirtyChange?.(isDirty);
    return () => onDirtyChange?.(false);
  }, [isDirty, onDirtyChange]);

  function save() {
    // Keep notifRooms within the (possibly just-edited) allowed set — the
    // server enforces this too, but trimming here keeps the wire honest.
    const notif = [...notifRooms].filter((id) => allowedRooms.has(id));
    send({
      type: "update_user",
      userId: user.id,
      changes: {
        name: name.trim(),
        role,
        allowedRooms: [...allowedRooms],
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
                    if (e.target.checked) next.add(room.id);
                    else next.delete(room.id);
                    setAllowedRooms(next);
                    if (!next.has(defaultRoomId ?? "")) setDefaultRoomId(next.values().next().value ?? null);
                    // A room you can't see can't notify you — drop it.
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
      <label style={{ ...dialogLabel, marginTop: 12 }}>Default room</label>
      <select value={defaultRoomId ?? ""} onChange={(e) => setDefaultRoomId(e.target.value || null)} style={dialogInput}>
        {[...allowedRooms].map((id) => {
          const room = rooms.find((r) => r.id === id);
          return room ? (
            <option key={id} value={id}>
              {room.name}
            </option>
          ) : null;
        })}
      </select>
      <NotificationPrefs rooms={rooms.filter((r) => allowedRooms.has(r.id))} notifRooms={notifRooms} onChange={setNotifRooms} />
      <label style={{ ...dialogLabel, marginTop: 12 }}>Env file path</label>
      <input value={envFile} onChange={(e) => setEnvFile(e.target.value)} placeholder="/absolute/path/to/.env" style={dialogInput} />
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

// Per-room notification preferences + the browser permission affordance.
// notifRooms is an allowlist of rooms whose agents alert this user (sound +
// desktop toast) when they finish while the tab is backgrounded.
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

function RoleBadge({ role }: { role: UserRole }) {
  return (
    <span
      title={role === "owner" ? "Owner - can invite users, revoke sessions, and set per-user room access" : "Member - can act in rooms the owner allowed"}
      style={{ fontSize: 9, textTransform: "uppercase", color: role === "owner" ? "var(--accent)" : "var(--text-ghost)", border: "1px solid var(--border)", borderRadius: 999, padding: "1px 6px" }}
    >
      {role}
    </span>
  );
}

function summarizeUser(user: UserRecord, rooms: { id: string; name: string }[]) {
  if (user.allowedRooms.length === rooms.length) return "All rooms";
  if (user.allowedRooms.length === 0) return "No rooms";
  const names = user.allowedRooms.map((id) => rooms.find((r) => r.id === id)?.name).filter(Boolean);
  return names.join(", ");
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
