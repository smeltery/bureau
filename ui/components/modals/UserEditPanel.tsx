import { useEffect, useState } from "react";
import type { UserRecord, UserRole } from "../../../shared/types.ts";
import type { GhostVariant } from "../../../shared/avatar.ts";
import { SUPPORTED_LANGUAGES, type SupportedLanguageCode } from "../../../shared/languages.ts";
import { addRawListener, removeRawListener, send } from "../../ws.ts";
import { dialogCancelBtn, dialogInput, dialogLabel, dialogSaveBtn } from "./dialog-styles.ts";
import { ManagedEnvEditor } from "./ManagedEnvEditor.tsx";
import { UserAvatarPicker } from "./UserAvatarPicker.tsx";
import { UserRoomPreferences } from "./UserRoomPreferences.tsx";

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
  const [language, setLanguage] = useState<SupportedLanguageCode | "">(user.language ?? "");
  const [slideMode, setSlideMode] = useState(user.slideMode === true);
  const [avatarColor, setAvatarColor] = useState(user.avatarColor);
  const [avatarVariant, setAvatarVariant] = useState<GhostVariant>(user.avatarVariant);
  const [envStatus, setEnvStatus] = useState<ValidationStatus>({ kind: "idle" });
  const userNotif = user.notifRooms ?? [];
  const userHidden = user.hidden ?? [];

  const isDirty =
    name !== user.name ||
    role !== user.role ||
    envFile !== (user.envFile ?? "") ||
    memberPrompt !== (user.memberPrompt ?? "") ||
    language !== (user.language ?? "") ||
    slideMode !== (user.slideMode === true) ||
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
        language: language || null,
        slideMode,
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
      <UserAvatarPicker color={avatarColor} variant={avatarVariant} onColorChange={setAvatarColor} onVariantChange={setAvatarVariant} />
      <UserRoomPreferences
        rooms={rooms}
        canEditAccess={canEditAccess}
        role={role}
        setRole={setRole}
        allowedRooms={allowedRooms}
        setAllowedRooms={setAllowedRooms}
        hiddenRooms={hiddenRooms}
        setHiddenRooms={setHiddenRooms}
        defaultRoomId={defaultRoomId}
        setDefaultRoomId={setDefaultRoomId}
        notifRooms={notifRooms}
        setNotifRooms={setNotifRooms}
      />
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
      <p style={{ fontSize: 10, color: "var(--text-muted)", margin: "4px 0 0", lineHeight: 1.4 }}>
        A file of NAME=value lines on the server, loaded into the environment of your agents and cron jobs. Use ANTHROPIC_API_KEY=... or OPENAI_API_KEY=... for API-key billing, or
        CLAUDE_CONFIG_DIR=... / CODEX_HOME=... for your own subscription sign-in. Each agent reads the file when it starts or resumes a conversation.
      </p>
      <div style={{ border: "1px solid var(--border-subtle)", borderRadius: 8, padding: 12, marginTop: 12 }}>
        <div style={{ fontSize: 12, fontWeight: 650, marginBottom: 6 }}>Managed variables for this user</div>
        <ManagedEnvEditor path={`/api/users/${encodeURIComponent(user.name)}/env`} onSavedPath={setEnvFile} />
      </div>
      <label style={{ ...dialogLabel, marginTop: 12 }}>Language</label>
      <select value={language} onChange={(e) => setLanguage(e.target.value as SupportedLanguageCode | "")} style={dialogInput}>
        <option value="">Default</option>
        {SUPPORTED_LANGUAGES.map((option) => (
          <option key={option.code} value={option.code}>
            {option.label}
          </option>
        ))}
      </select>
      <p style={{ fontSize: 10, color: "var(--text-ghost)", margin: "4px 0 0" }}>Agents you spawn use this as your default reply and speech language.</p>
      <label style={{ ...dialogLabel, display: "flex", gap: 8, marginTop: 12 }}>
        <input type="checkbox" checked={slideMode} onChange={(e) => setSlideMode(e.target.checked)} style={{ accentColor: "var(--accent)", cursor: "pointer" }} />
        <span>Slide Mode</span>
      </label>
      <p style={{ fontSize: 10, color: "var(--text-ghost)", margin: "2px 0 0 24px", lineHeight: 1.4 }}>Shows the slide view toggle on agent logs.</p>
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

const smallBtn: React.CSSProperties = {
  border: "1px solid var(--border)",
  background: "var(--btn-surface)",
  color: "var(--text-dim)",
  borderRadius: 7,
  padding: "5px 9px",
  fontSize: 11,
  cursor: "pointer",
};
