import type { InviteWire, SessionWire } from "../../shared/types.ts";
import { useAppState } from "../store.tsx";
import { send } from "../ws.ts";

export function InvitesTable({ invites }: { invites: InviteWire[] }) {
  const { rooms, allRooms } = useAppState();
  const roomList = allRooms.length > 0 ? allRooms : rooms;
  return (
    <table style={tableStyle}>
      <thead>
        <tr>
          <th style={th}>For</th>
          <th style={th}>Role</th>
          <th style={th}>Rooms</th>
          <th style={th}>Expires</th>
          <th style={th}>Prefix</th>
          <th style={th}></th>
        </tr>
      </thead>
      <tbody>
        {invites.map((i) => (
          <tr key={i.tokenPrefix}>
            <td style={td}>{i.username ?? <i>{i.bootstrap ? "(bootstrap)" : "—"}</i>}</td>
            <td style={td}>{i.role}</td>
            <td style={td}>{formatInviteRooms(i, roomList)}</td>
            <td style={td}>{formatExpiry(i.expiresAt)}</td>
            <td style={mono}>{i.tokenPrefix}…</td>
            <td style={td}>
              <button onClick={() => send({ type: "revoke_invite", tokenPrefix: i.tokenPrefix })} style={smallBtn}>
                Revoke
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
  const { sessionContext } = useAppState();
  const currentPrefix = sessionContext?.currentSessionPrefix ?? null;
  return (
    <table style={tableStyle}>
      <thead>
        <tr>
          <th style={th}>User</th>
          <th style={th}>Last seen</th>
          <th style={th}>Created</th>
          <th style={th}>User-Agent</th>
          <th style={th}>Prefix</th>
          <th style={th}></th>
        </tr>
      </thead>
      <tbody>
        {sessions.map((s) => {
          const isCurrent = s.sessionPrefix === currentPrefix;
          return (
            <tr key={s.sessionPrefix}>
              <td style={td}>{s.username}</td>
              <td style={td}>{formatRelative(s.lastSeenAt)}</td>
              <td style={td}>{formatRelative(s.createdAt)}</td>
              <td style={tdEllipsis}>{s.userAgent ?? "—"}</td>
              <td style={mono}>{s.sessionPrefix}…</td>
              <td style={td}>
                {isCurrent ? (
                  <span style={{ fontSize: 10, color: "var(--text-ghost)", fontStyle: "italic" }} title="Use Sign out to end your current session.">
                    Current session
                  </span>
                ) : (
                  <button onClick={() => send({ type: "revoke_session", sessionPrefix: s.sessionPrefix })} style={smallBtn}>
                    Revoke
                  </button>
                )}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function formatRelative(ts: number): string {
  const diffMs = Date.now() - ts;
  const m = Math.round(diffMs / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h}h ago`;
  const d = Math.round(h / 24);
  return `${d}d ago`;
}

function formatExpiry(ts: number): string {
  const diffMs = ts - Date.now();
  if (diffMs <= 0) return "expired";
  const h = Math.round(diffMs / 3600_000);
  if (h < 48) return `${h}h`;
  const d = Math.round(h / 24);
  return `${d}d`;
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
const smallBtn: React.CSSProperties = {
  padding: "3px 8px",
  fontSize: 11,
  borderRadius: 4,
  border: "1px solid var(--border)",
  background: "transparent",
  color: "var(--text-dim)",
  cursor: "pointer",
};
