import { useCallback, useEffect, useMemo, useState } from "react";
import { storageSetItem } from "../browser-storage.ts";
import { useAppState } from "../store.tsx";
import { send } from "../ws.ts";
import type { UserRole } from "../../shared/types.ts";
import { dialogCancelBtn, dialogInput, dialogLabel, dialogSaveBtn } from "./modals/dialog-styles.ts";
import { AccessPane, sectionHeader } from "./AccessPane.tsx";
import { InvitesPane } from "./InvitesPane.tsx";
import { MyDevicesPane } from "./MyDevicesPane.tsx";
import { ApiTokensPane } from "./ApiTokensPane.tsx";
import { SessionsPane } from "./SessionsPane.tsx";
import { buildAccountSections, type AccountSection } from "./UserSettingsSections.ts";
import { UserSettingsRosterMeta } from "./UserSettingsRosterMeta.tsx";
import { MemberVariableNames } from "./MemberVariableNames.tsx";
import { ConnectionsPane } from "./ConnectionsPane.tsx";
import { OfficeVariablesPane } from "./OfficeVariablesPane.tsx";
import { PersonalVariablesPane } from "./PersonalVariablesPane.tsx";
import { SignOutPane } from "./SignOutPane.tsx";
import { StorageModal } from "./modals/StorageModal.tsx";
import { UsageModal } from "./modals/UsageModal.tsx";
import { UserEditPanel } from "./modals/UserEditPanel.tsx";
import { UnsavedChangesPrompt, settingsLeaveKind, useUnsavedChangesPrompt } from "./modals/UnsavedChangesPrompt.tsx";
import { useI18n } from "../i18n.tsx";
type Selection = { kind: "user"; id: string } | { kind: "section"; section: AccountSection };
export function UserSettingsView({
  currentUsername,
  initialUserId,
  initialSection,
  onSwitchUser,
  onClose,
}: {
  currentUsername: string | null;
  initialUserId?: string | null;
  initialSection?: AccountSection | null;
  onSwitchUser: (name: string) => void;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const { users, rooms, allRooms, sessionContext, activeSessions, activeSessionsLoaded, presences, isMobile } = useAppState();
  const isOwner = sessionContext?.role === "owner";
  const userList = useMemo(() => [...users.values()].sort((a, b) => a.name.localeCompare(b.name)), [users]);
  const editorRooms = allRooms.length ? allRooms : rooms;
  const [newName, setNewName] = useState("");
  const [selection, setSelection] = useState<Selection | null>(() => {
    if (initialSection) return { kind: "section", section: initialSection };
    if (initialUserId) return { kind: "user", id: initialUserId };
    if (!isMobile && sessionContext?.userId) return { kind: "user", id: sessionContext.userId };
    return null;
  });
  const [detailDirty, setDetailDirty] = useState(false);
  const [storageDeleting, setStorageDeleting] = useState(false);
  const leaveKind = settingsLeaveKind(detailDirty, storageDeleting);
  const discardPrompt = useUnsavedChangesPrompt(leaveKind !== "none", undefined, () => setDetailDirty(false));
  const selectedUser = selection?.kind === "user" ? userList.find((user) => user.id === selection.id) : null;
  const accountSections = buildAccountSections(isOwner, !!sessionContext);
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      if (isMobile && selection) {
        select(null);
      } else {
        requestClose();
      }
    }
    window.addEventListener("keydown", handleKey, true);
    return () => window.removeEventListener("keydown", handleKey, true);
  });
  useEffect(() => {
    if (selection || isMobile || !sessionContext?.userId) return;
    if (userList.some((user) => user.id === sessionContext.userId)) {
      setSelection({ kind: "user", id: sessionContext.userId });
    }
  }, [isMobile, selection, sessionContext?.userId, userList]);

  useEffect(() => {
    if (isOwner && !activeSessionsLoaded) send({ type: "list_active_sessions" });
  }, [isOwner, activeSessionsLoaded]);

  function select(next: Selection | null) {
    discardPrompt.requestLeave(() => {
      setDetailDirty(false);
      setSelection(next);
    });
  }

  function requestClose() {
    discardPrompt.requestLeave(onClose);
  }

  function switchUser(name: string) {
    storageSetItem("bureau-username", name);
    onSwitchUser(name);
    send({ type: "claim_user", username: name });
    requestClose();
  }

  function createUser() {
    const name = newName.trim();
    if (!name) return;
    switchUser(name);
    setNewName("");
  }

  const setDetailDirtyCb = useCallback((dirty: boolean) => {
    setDetailDirty(dirty);
  }, []);

  const showSidebar = !isMobile || selection === null;
  const showDetail = !isMobile || selection !== null;

  return (
    <div
      style={{
        height: isMobile ? "100dvh" : "100vh",
        display: "flex",
        flexDirection: "column",
        background: "var(--bg-base)",
        color: "var(--text-primary)",
      }}
    >
      <div style={headerStyle(isMobile)}>
        <button onClick={isMobile && selection ? () => select(null) : requestClose} style={backBtn}>
          &larr;
        </button>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 15, fontWeight: 700 }}>{t("settings.title")}</div>
          {!isMobile && <div style={{ fontSize: 11, color: "var(--text-ghost)" }}>{t("settings.subtitle")}</div>}
        </div>
      </div>

      <div style={{ flex: 1, minHeight: 0, display: "flex", overflow: "hidden" }}>
        {showSidebar && (
          <aside style={sidebarStyle(isMobile)}>
            {accountSections.length > 0 && (
              <div>
                <div style={sidebarLabel}>{t("settings.sidebar.account")}</div>
                {accountSections.map((entry) => (
                  <SidebarButton
                    key={entry.section}
                    active={selection?.kind === "section" && selection.section === entry.section}
                    label={t(entry.labelKey)}
                    onClick={() => select({ kind: "section", section: entry.section })}
                  />
                ))}
              </div>
            )}

            <div style={{ marginTop: 18 }}>
              <div style={sidebarLabel}>{t("settings.sidebar.users")}</div>
              {userList.map((user) => {
                const isMe = sessionContext ? sessionContext.userId === user.id : currentUsername?.toLocaleLowerCase() === user.name.toLocaleLowerCase();
                const canEdit = isOwner || isMe;
                return (
                  <div key={user.id} style={{ display: "flex", gap: 8, alignItems: "center" }}>
                    <button
                      onClick={() => canEdit && select({ kind: "user", id: user.id })}
                      disabled={!canEdit}
                      style={{
                        ...rowButton,
                        background: selection?.kind === "user" && selection.id === user.id ? "var(--bg-hover)" : isMe ? "var(--bg-input)" : "transparent",
                        cursor: canEdit ? "pointer" : "default",
                        opacity: canEdit ? 1 : 0.65,
                      }}
                    >
                      <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {user.name}
                        {isMe ? ` ${t("settings.you")}` : ""}
                      </span>
                      <RoleBadge role={user.role} />
                      <UserSettingsRosterMeta user={user} rooms={editorRooms} presences={presences} sessions={activeSessions} showSessionStats={isOwner} />
                    </button>
                    {!isMe && (
                      <button style={smallBtn} onClick={() => switchUser(user.name)}>
                        {t("common.use")}
                      </button>
                    )}
                  </div>
                );
              })}
            </div>

            <div style={{ marginTop: 18 }}>
              <div style={sidebarLabel}>{t("settings.sidebar.createClaim")}</div>
              <div style={{ display: "flex", gap: 8 }}>
                <input
                  value={newName}
                  onChange={(e) => setNewName(e.target.value.slice(0, 64))}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.nativeEvent.isComposing) createUser();
                    e.stopPropagation();
                  }}
                  placeholder={t("settings.usernamePlaceholder")}
                  style={dialogInput}
                />
                <button onClick={createUser} style={{ ...dialogSaveBtn, flexShrink: 0 }}>
                  {t("common.use")}
                </button>
              </div>
            </div>
          </aside>
        )}

        {showDetail && (
          <main style={detailStyle(isMobile)}>
            {selectedUser ? (
              <section>
                <h3 style={sectionHeader}>
                  {selectedUser.name}
                  {sessionContext?.userId === selectedUser.id ? ` ${t("settings.you")}` : ""}
                </h3>
                <UserEditPanel
                  user={selectedUser}
                  rooms={editorRooms}
                  canEditAccess={isOwner}
                  onClose={() => {
                    setDetailDirty(false);
                    if (isMobile) setSelection(null);
                  }}
                  onDirtyChange={setDetailDirtyCb}
                />
                {isOwner && <MemberVariableNames username={selectedUser.name} />}
              </section>
            ) : selection?.kind === "section" && selection.section === "access" ? (
              <AccessPane onDirtyChange={setDetailDirtyCb} />
            ) : selection?.kind === "section" && selection.section === "connections" && sessionContext ? (
              <ConnectionsPane username={sessionContext.username} />
            ) : selection?.kind === "section" && selection.section === "office-env" ? (
              <OfficeVariablesPane />
            ) : selection?.kind === "section" && selection.section === "personal-env" && sessionContext ? (
              <PersonalVariablesPane username={sessionContext.username} />
            ) : selection?.kind === "section" && selection.section === "usage" ? (
              <UsageModal embedded />
            ) : selection?.kind === "section" && selection.section === "storage" && isOwner ? (
              <StorageModal embedded onDeletingChange={setStorageDeleting} />
            ) : selection?.kind === "section" && selection.section === "invites" ? (
              <InvitesPane />
            ) : selection?.kind === "section" && selection.section === "sessions" ? (
              <SessionsPane />
            ) : selection?.kind === "section" && selection.section === "devices" ? (
              <MyDevicesPane />
            ) : selection?.kind === "section" && selection.section === "api-tokens" ? (
              <ApiTokensPane />
            ) : selection?.kind === "section" && selection.section === "signout" ? (
              <SignOutPane />
            ) : (
              <div style={{ color: "var(--text-ghost)", fontSize: 13 }}>{t("settings.selectHint")}</div>
            )}
            {discardPrompt.open && (
              <UnsavedChangesPrompt
                message={leaveKind === "storage-leave" ? t("storage.leaveConfirm") : undefined}
                confirmLabel={leaveKind === "storage-leave" ? t("storage.leave") : undefined}
                onDiscard={discardPrompt.discard}
                onCancel={discardPrompt.cancel}
              />
            )}
          </main>
        )}
      </div>
    </div>
  );
}

function SidebarButton({ active, label, onClick }: { active: boolean; label: string; onClick: () => void }) {
  return (
    <button onClick={onClick} style={{ ...rowButton, display: "block", background: active ? "var(--bg-hover)" : "transparent" }}>
      {label}
    </button>
  );
}

function RoleBadge({ role }: { role: UserRole }) {
  const { t } = useI18n();
  return (
    <span
      style={{
        justifySelf: "end",
        fontSize: 9,
        textTransform: "uppercase",
        color: role === "owner" ? "var(--accent)" : "var(--text-ghost)",
        border: "1px solid var(--border)",
        borderRadius: 999,
        padding: "1px 6px",
      }}
    >
      {role === "owner" ? t("settings.role.owner") : t("settings.role.member")}
    </span>
  );
}

function headerStyle(isMobile: boolean): React.CSSProperties {
  return {
    display: "flex",
    alignItems: "center",
    gap: 10,
    padding: isMobile ? "0 12px" : "0 20px",
    paddingTop: isMobile ? "env(safe-area-inset-top, 0px)" : undefined,
    minHeight: 44,
    background: "var(--bg-hud)",
    backdropFilter: "blur(16px)",
    borderBottom: "1px solid var(--border-subtle)",
    flexShrink: 0,
    zIndex: 500,
  };
}

function sidebarStyle(isMobile: boolean): React.CSSProperties {
  return {
    width: isMobile ? "100%" : 320,
    maxWidth: "100%",
    borderRight: isMobile ? "none" : "1px solid var(--border-subtle)",
    overflowY: "auto",
    padding: isMobile ? "14px 12px" : "18px 20px",
  };
}

function detailStyle(isMobile: boolean): React.CSSProperties {
  return {
    flex: 1,
    minWidth: 0,
    overflowY: "auto",
    padding: isMobile ? "14px 12px" : "20px 28px",
  };
}

const backBtn: React.CSSProperties = {
  background: "none",
  border: "none",
  color: "var(--text-muted)",
  fontSize: 18,
  cursor: "pointer",
  padding: "2px 8px",
};
const sidebarLabel: React.CSSProperties = { ...dialogLabel, marginBottom: 6, textTransform: "uppercase", letterSpacing: "0.05em" };
const rowButton: React.CSSProperties = {
  width: "100%",
  display: "grid",
  gridTemplateColumns: "minmax(0, 1fr) auto",
  alignItems: "center",
  gap: 8,
  border: "1px solid var(--border-subtle)",
  borderRadius: 8,
  padding: "8px 10px",
  marginBottom: 6,
  background: "transparent",
  color: "var(--text-primary)",
  textAlign: "left",
  fontSize: 12,
};

const smallBtn: React.CSSProperties = {
  border: "1px solid var(--border)",
  background: "var(--btn-surface)",
  color: "var(--text-dim)",
  borderRadius: 7,
  padding: "5px 9px",
  fontSize: 11,
  cursor: "pointer",
};
