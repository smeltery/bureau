import { useI18n } from "../i18n.tsx";
import { translatorFor } from "../../shared/i18n/translate.ts";
import type { SupportedLanguageCode } from "../../shared/languages.ts";
import { Fragment } from "react";
import type { InviteWire, SessionWire } from "../../shared/types.ts";
import { useAppState } from "../store.tsx";
import { send } from "../ws.ts";

export function InvitesTable({ invites }: { invites: InviteWire[] }) {
  const { t, language } = useI18n();
  const { rooms, allRooms } = useAppState();
  const roomList = allRooms.length > 0 ? allRooms : rooms;
  return (
    <table style={tableStyle}>
      <thead>
        <tr>
          <th style={th}>{t("accessUi.for")}</th>
          <th style={th}>{t("accessUi.role")}</th>
          <th style={th}>{t("accessUi.rooms")}</th>
          <th style={th}>{t("accessUi.expires")}</th>
          <th style={th}>{t("accessUi.prefix")}</th>
          <th style={th}></th>
        </tr>
      </thead>
      <tbody>
        {invites.map((i) => (
          <tr key={i.tokenPrefix}>
            <td style={td}>{i.username ?? <i>{i.bootstrap ? t("accessUi.bootstrap") : "—"}</i>}</td>
            <td style={td}>{t(i.role === "owner" ? "common.owner" : "common.member")}</td>
            <td style={td}>{formatInviteRooms(i, roomList)}</td>
            <td style={td}>{formatExpiry(i.expiresAt, language)}</td>
            <td style={mono}>{i.tokenPrefix}…</td>
            <td style={td}>
              <button onClick={() => send({ type: "revoke_invite", tokenPrefix: i.tokenPrefix })} style={smallBtn}>
                {t("accessUi.revoke")}
              </button>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function formatInviteRooms(invite: Pick<InviteWire, "allowedRooms">, rooms: Pick<import("../../shared/types.ts").RoomWire, "id" | "name">[]): string {
  if (!invite.allowedRooms?.length) return "—";
  return invite.allowedRooms.map((id) => rooms.find((room) => room.id === id)?.name ?? id).join(", ");
}

export function SessionsTable({ sessions }: { sessions: SessionWire[] }) {
  const { t, language } = useI18n();
  const { sessionContext } = useAppState();
  const currentPrefix = sessionContext?.currentSessionPrefix ?? null;
  return (
    <table style={tableStyle}>
      <thead>
        <tr>
          <th style={th}>{t("accessUi.user")}</th>
          <th style={th}>{t("accessUi.lastSeen")}</th>
          <th style={th}>{t("accessUi.created")}</th>
          <th style={th}>{t("accessUi.userAgent")}</th>
          <th style={th}>{t("accessUi.prefix")}</th>
          <th style={th}></th>
        </tr>
      </thead>
      <tbody>
        {sessions.map((s) => {
          const isCurrent = s.sessionPrefix === currentPrefix;
          return (
            <Fragment key={s.sessionPrefix}>
              <tr>
                <td style={sessionPrimaryCell}>{s.username}</td>
                <td style={sessionPrimaryCell}>{formatRelative(s.lastSeenAt, language)}</td>
                <td style={sessionPrimaryCell}>{formatRelative(s.createdAt, language)}</td>
                <td style={sessionPrimaryEllipsis}>{s.userAgent ?? "—"}</td>
                <td style={sessionPrimaryMono}>{s.sessionPrefix}…</td>
                <td style={sessionPrimaryCell}>
                  {isCurrent ? (
                    <span style={{ fontSize: 10, color: "var(--text-ghost)", fontStyle: "italic" }} title={t("accessUi.currentHint")}>
                      {t("accessUi.current")}
                    </span>
                  ) : (
                    <button onClick={() => send({ type: "revoke_session", sessionPrefix: s.sessionPrefix })} style={smallBtn}>
                      {t("accessUi.revoke")}
                    </button>
                  )}
                </td>
              </tr>
              <tr>
                <td colSpan={6} style={sessionExpiryCell}>
                  <div style={sessionExpiryStyle}>
                    {sessionExpiryLines(s, language).map((line) => (
                      <span key={line.label}>
                        {line.label}: {line.value}
                      </span>
                    ))}
                  </div>
                </td>
              </tr>
            </Fragment>
          );
        })}
      </tbody>
    </table>
  );
}

function formatRelative(ts: number, language: SupportedLanguageCode): string {
  const minutes = Math.round((Date.now() - ts) / 60000);
  if (minutes < 1) return translatorFor(language).t("accessUi.justNow");
  const hours = Math.round(minutes / 60);
  const format = new Intl.RelativeTimeFormat(language);
  return minutes < 60 ? format.format(-minutes, "minute") : hours < 48 ? format.format(-hours, "hour") : format.format(-Math.round(hours / 24), "day");
}

function formatExpiry(ts: number, language: SupportedLanguageCode): string {
  const diffMs = ts - Date.now();
  if (diffMs <= 0) return translatorFor(language).t("accessUi.expired");
  const hours = Math.round(diffMs / 3600_000);
  const format = new Intl.RelativeTimeFormat(language);
  return hours < 48 ? format.format(hours, "hour") : format.format(Math.round(hours / 24), "day");
}

export function formatAbsoluteLocal(ts: number, language: SupportedLanguageCode = "en"): string {
  return new Intl.DateTimeFormat(language, { year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", timeZoneName: "short" }).format(ts);
}

export function sessionExpiryLines(session: Pick<SessionWire, "expiresAt" | "absoluteExpiresAt">, language: SupportedLanguageCode = "en"): { label: string; value: string }[] {
  const { t } = translatorFor(language);
  return [
    { label: t("accessUi.inactivity"), value: formatAbsoluteLocal(session.expiresAt, language) },
    { label: t("accessUi.latest"), value: formatAbsoluteLocal(session.absoluteExpiresAt, language) },
  ];
}

const tableStyle: React.CSSProperties = {
  width: "100%",
  fontSize: 11,
  borderCollapse: "collapse",
};
const th: React.CSSProperties = {
  textAlign: "left",
  fontWeight: 600,
  color: "var(--text-ghost)",
  padding: "4px 6px",
  borderBottom: "1px solid var(--border-subtle)",
};
const td: React.CSSProperties = {
  padding: "4px 6px",
  borderBottom: "1px solid var(--border-subtle)",
  color: "var(--text-primary)",
};
const tdEllipsis: React.CSSProperties = {
  ...td,
  maxWidth: 200,
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
};
const mono: React.CSSProperties = {
  ...td,
  fontFamily: "'JetBrains Mono', monospace",
  fontSize: 10,
  color: "var(--text-hint)",
};
const sessionPrimaryCell: React.CSSProperties = {
  ...td,
  borderBottom: "none",
};
const sessionPrimaryEllipsis: React.CSSProperties = {
  ...tdEllipsis,
  borderBottom: "none",
};
const sessionPrimaryMono: React.CSSProperties = {
  ...mono,
  borderBottom: "none",
};
const sessionExpiryStyle: React.CSSProperties = {
  display: "flex",
  flexWrap: "wrap",
  gap: "3px 16px",
  color: "var(--text-hint)",
  lineHeight: 1.3,
};
const sessionExpiryCell: React.CSSProperties = {
  ...td,
  paddingTop: 1,
};
const smallBtn: React.CSSProperties = {
  padding: "3px 8px",
  fontSize: 11,
  borderRadius: 4,
  border: "1px solid var(--border)",
  background: "transparent",
  color: "var(--text-dim)",
  cursor: "pointer",
};
