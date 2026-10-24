import { useI18n } from "../../i18n.tsx";
import type { Translator } from "../../../shared/i18n/translate.ts";
import { useEffect, useMemo, useRef, useState } from "react";
import { storageSetItem } from "../../browser-storage.ts";
import { useAppState } from "../../store.tsx";
import { send } from "../../ws.ts";
import type { UserRecord, UserRole } from "../../../shared/types.ts";
import { Modal } from "./Modal.tsx";
import { dialogCancelBtn, dialogInput, dialogLabel, dialogSaveBtn } from "./dialog-styles.ts";
import { AccessPane } from "../AccessPane.tsx";
import { MyDevicesPane } from "../MyDevicesPane.tsx";
import { UserEditPanel } from "./UserEditPanel.tsx";

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
  const { t } = useI18n();
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
  function confirmDiscard() {
    return !editIsDirtyRef.current || window.confirm(t("common.discardPrompt"));
  }
  function requestClose() {
    if (!confirmDiscard()) return;
    onClose?.();
  }

  useEffect(() => {
    if (initialUserId) setEditingId(initialUserId);
  }, [initialUserId]);

  function switchUser(name: string) {
    if (!confirmDiscard()) return false;
    storageSetItem("bureau-username", name);
    onSwitchUser(name);
    send({ type: "claim_user", username: name });
    if (dismissable) onClose?.();
    return true;
  }

  function createUser() {
    const name = newName.trim();
    if (!name) return;
    if (switchUser(name)) setNewName("");
  }

  return (
    <Modal onClose={dismissable ? requestClose : () => {}} width={680} allowBackdropClose={dismissable}>
      <h3 style={{ fontSize: 17, fontWeight: 700, margin: 0, color: "var(--text-primary)" }}>{forceCreate ? t("settingsUi.welcome") : t("settings.title")}</h3>
      <p style={{ fontSize: 11, color: "var(--text-ghost)", margin: "6px 0 0", lineHeight: 1.4 }}>{t("settingsUi.profilesHint")}</p>

      {userList.length > 0 && (
        <>
          <div style={{ ...dialogLabel, marginTop: 18 }}>{t("settings.sidebar.users")}</div>
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
                          {isMe ? ` ${t("settings.you")}` : ""}
                        </span>
                        <RoleBadge role={u.role} />
                      </div>
                      <div style={{ marginTop: 2, fontSize: 10, color: "var(--text-hint)", fontFamily: "'JetBrains Mono',monospace" }}>{summarizeUser(u, editorRooms, t)}</div>
                    </div>
                    {!isMe && (
                      <button style={smallBtn} onClick={() => switchUser(u.name)}>
                        {t("common.use")}
                      </button>
                    )}
                    {(isOwner || isMe) && (
                      <button
                        style={smallBtn}
                        onClick={() => {
                          if (confirmDiscard()) setEditingId(isEditing ? null : u.id);
                        }}
                      >
                        {isEditing ? t("common.close") : t("common.edit")}
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

      <div style={{ ...dialogLabel, marginTop: 18 }}>{t("settings.sidebar.createClaim")}</div>
      <div style={{ display: "flex", gap: 8 }}>
        <input
          value={newName}
          onChange={(e) => setNewName(e.target.value.slice(0, 64))}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.nativeEvent.isComposing) createUser();
          }}
          aria-label={t("settings.usernamePlaceholder")}
          placeholder={t("settings.usernamePlaceholder")}
          style={dialogInput}
        />
        <button onClick={createUser} style={{ ...dialogSaveBtn, flexShrink: 0 }}>
          {t("common.use")}
        </button>
      </div>

      {isOwner && <AccessPane />}
      {sessionContext && <MyDevicesPane />}

      {sessionContext && (
        <div style={{ marginTop: 22 }}>
          <h4 style={{ fontSize: 13, margin: 0, color: "var(--text-primary)" }}>{t("common.signOut")}</h4>
          <p style={{ fontSize: 11, margin: "5px 0 8px", color: "var(--text-ghost)" }}>{t("accessUi.signOutHint")}</p>
          {/* HTML form POST so the browser sends the cookie and the server's
              /auth/logout handler can apply the lockout-prevention check
              before clearing it. The WS-side logout sets session_context to
              null on success but doesn't itself clear the cookie. */}
          <form
            method="POST"
            action="/auth/logout"
            onSubmit={(event) => {
              if (!confirmDiscard()) event.preventDefault();
            }}
            style={{ margin: 0 }}
          >
            <button type="submit" style={signOutBtn}>
              {t("common.signOut")}
            </button>
          </form>
        </div>
      )}

      {dismissable && (
        <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 18 }}>
          <button onClick={requestClose} style={dialogCancelBtn}>
            {t("common.close")}
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

function RoleBadge({ role }: { role: UserRole }) {
  const { t } = useI18n();
  return (
    <span
      title={role === "owner" ? t("settingsUi.ownerHint") : t("settingsUi.memberHint")}
      style={{ fontSize: 9, textTransform: "uppercase", color: role === "owner" ? "var(--accent)" : "var(--text-ghost)", border: "1px solid var(--border)", borderRadius: 999, padding: "1px 6px" }}
    >
      {role === "owner" ? t("settings.role.owner") : t("settings.role.member")}
    </span>
  );
}

function summarizeUser(user: UserRecord, rooms: { id: string; name: string }[], t: Translator["t"]) {
  if (user.allowedRooms.length === rooms.length) return t("profile.allRooms");
  if (user.allowedRooms.length === 0) return t("profile.noRooms");
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
