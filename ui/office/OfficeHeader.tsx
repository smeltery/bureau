import type { ReactNode } from "react";
import { SunIcon, MoonIcon } from "../components/controls/Icons.tsx";
import { useI18n } from "../i18n.tsx";

export interface OfficeHeaderCounts {
  working: number;
  waiting: number;
  error: number;
  idle: number;
}

export function DesktopOfficeHeader({
  counts,
  mode,
  username,
  updateAvailable,
  onOpenTasks,
  onOpenCronjobs,
  onOpenApps,
  onOpenPlugins,
  onOpenTeamChat,
  onEditUsername,
  onOpenDeviceSettings,
  onEditOfficePrompt,
  onEditRoomSettings,
  onOpenUpdate,
  onOpenTheme,
}: {
  counts: OfficeHeaderCounts;
  mode: "dark" | "light";
  username: string;
  updateAvailable: boolean;
  onOpenTasks: () => void;
  onOpenCronjobs?: () => void;
  onOpenApps?: () => void;
  onOpenPlugins?: () => void;
  onOpenTeamChat?: () => void;
  onEditUsername: () => void;
  onOpenDeviceSettings: () => void;
  onEditOfficePrompt: () => void;
  onEditRoomSettings?: () => void;
  onOpenUpdate: () => void;
  onOpenTheme: () => void;
}) {
  const { t } = useI18n();
  const statusLabels = {
    working: t("office.status.working"),
    waiting: t("office.status.waiting"),
    error: t("office.status.error"),
    idle: t("office.status.idle"),
  } as const;
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "minmax(0, 1fr) auto minmax(0, 1fr)",
        alignItems: "center",
        padding: "0 20px",
        height: 44,
        background: "var(--bg-hud)",
        backdropFilter: "blur(16px)",
        borderBottom: "1px solid var(--border-subtle)",
        flexShrink: 0,
        zIndex: 500,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 9, justifySelf: "start", minWidth: 0 }}>
        <span style={{ fontSize: 15, fontWeight: 700, letterSpacing: "-0.02em", color: "var(--text-primary)" }}>Bureau</span>
        {updateAvailable && (
          <span
            onClick={onOpenUpdate}
            style={{
              fontSize: 11,
              fontWeight: 600,
              color: "var(--blue, #58a6ff)",
              fontFamily: "'JetBrains Mono',monospace",
              letterSpacing: "0.02em",
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              gap: 5,
            }}
          >
            <span style={{ width: 7, height: 7, borderRadius: "50%", background: "var(--blue, #58a6ff)", boxShadow: "0 0 8px var(--blue, #58a6ff)" }} />
            {t("office.header.updateAvailable")}
          </span>
        )}
      </div>
      <div style={{ display: "flex", gap: 12, justifySelf: "center" }}>
        {(
          [
            { n: counts.working, c: "var(--green)", l: "working" as const },
            { n: counts.waiting, c: "var(--purple)", l: "waiting" as const },
            { n: counts.error, c: "var(--red)", l: "error" as const },
            { n: counts.idle, c: "var(--text-muted)", l: "idle" as const },
          ] as const
        )
          .filter((s) => s.n > 0)
          .map((s) => (
            <div
              key={s.l}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 5,
                fontSize: 10,
                fontWeight: 600,
                color: s.c,
                fontFamily: "'JetBrains Mono',monospace",
                letterSpacing: "0.02em",
              }}
            >
              <span
                style={{
                  width: 6,
                  height: 6,
                  borderRadius: "50%",
                  background: s.c,
                  boxShadow: `0 0 6px ${s.c}`,
                }}
              />
              {s.n} {statusLabels[s.l]}
            </div>
          ))}
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 8, justifySelf: "end" }}>
        <HeaderButton icon={<TasksIcon />} label={t("common.tasks")} onClick={onOpenTasks} />
        {onOpenTeamChat && <HeaderButton icon={<ChatIcon />} label={t("common.teamChat")} title={t("common.teamChat")} onClick={onOpenTeamChat} />}
        {onOpenCronjobs && <HeaderButton icon={<ClockIcon />} label={t("common.schedules")} title={t("common.schedules")} onClick={onOpenCronjobs} />}
        {onOpenApps && <HeaderButton icon={<AppsIcon />} label={t("common.apps")} title={t("office.header.appsTitle")} onClick={onOpenApps} />}
        {onOpenPlugins && <HeaderButton icon={<PlugIcon />} label={t("common.plugins")} title={t("office.header.pluginsTitle")} onClick={onOpenPlugins} />}
        <HeaderButton icon={<UserIcon />} label={t("common.user")} title={username || t("office.header.userSettings")} onClick={onEditUsername} />
        <HeaderButton icon={<DeviceIcon />} label={t("common.device")} title={t("office.header.deviceSettings")} onClick={onOpenDeviceSettings} />
        <HeaderButton icon={<BuildingIcon />} label={t("common.office")} title={t("office.header.officeSettings")} onClick={onEditOfficePrompt} />
        {onEditRoomSettings && <HeaderButton icon={<DoorIcon />} label={t("common.room")} title={t("office.header.roomSettings")} onClick={onEditRoomSettings} />}
        <HeaderButton icon={mode === "dark" ? <MoonIcon /> : <SunIcon />} label={t("common.theme")} title={t("common.changeTheme")} onClick={onOpenTheme} />
      </div>
    </div>
  );
}

export function BuildingIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4">
      <rect x="3" y="2" width="10" height="13" />
      <line x1="6" y1="5" x2="6" y2="6" />
      <line x1="10" y1="5" x2="10" y2="6" />
      <line x1="6" y1="9" x2="6" y2="10" />
      <line x1="10" y1="9" x2="10" y2="10" />
      <line x1="7" y1="13" x2="9" y2="13" />
    </svg>
  );
}

export function DoorIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4">
      <rect x="4" y="2" width="8" height="13" />
      <circle cx="10" cy="9" r="0.6" fill="currentColor" />
    </svg>
  );
}

function TasksIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 4.5l1.3 1.3L6.8 3.3" />
      <path d="M3 8.5l1.3 1.3L6.8 7.3" />
      <path d="M9 4.5h4.5M9 8.5h4.5M3 12.5h10.5" />
    </svg>
  );
}

function ChatIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 3.5h10a1.5 1.5 0 0 1 1.5 1.5v5A1.5 1.5 0 0 1 13 11.5H7l-3 2v-2H3A1.5 1.5 0 0 1 1.5 10V5A1.5 1.5 0 0 1 3 3.5z" />
    </svg>
  );
}

function ClockIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="8" cy="8" r="6" />
      <path d="M8 4.5V8l2.5 1.5" />
    </svg>
  );
}

// A browser window with a running dot: an app is a web app bureau serves.
function AppsIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="3" width="12" height="10" rx="1.5" />
      <path d="M2 6h12" />
      <circle cx="4.2" cy="4.5" r="0.55" fill="currentColor" stroke="none" />
    </svg>
  );
}

function PlugIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
      <path d="M5.5 2v3M10.5 2v3" />
      <path d="M4 5h8v2.5a4 4 0 0 1-8 0V5z" />
      <path d="M8 11.5V14" />
    </svg>
  );
}

function UserIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round">
      <circle cx="8" cy="5" r="2.3" />
      <path d="M3.5 13c.7-2.4 2.2-3.6 4.5-3.6s3.8 1.2 4.5 3.6" />
    </svg>
  );
}

function DeviceIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
      <rect x="5" y="1.5" width="6" height="13" rx="1.2" />
      <path d="M7.4 12.2h1.2" />
    </svg>
  );
}

function HeaderButton({ icon, label, title, onClick }: { icon: ReactNode; label: string; title?: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      title={title}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        padding: "7px 13px",
        borderRadius: 8,
        border: "1px solid var(--border-medium)",
        background: "var(--btn-surface)",
        color: "var(--text-dim)",
        fontSize: 12,
        fontWeight: 600,
        cursor: "pointer",
        whiteSpace: "nowrap",
      }}
    >
      {icon}
      <span>{label}</span>
    </button>
  );
}
