// Owner-only Access section: list outstanding invites + active sessions,
// issue new invites, revoke either, toggle external access. Mounts inside
// UserManagementModal when the current session's role is "owner".

import { useEffect, useRef, useState } from "react";
import { useAppState } from "../store.tsx";
import { send, addRawListener, removeRawListener } from "../ws.ts";
import type { InviteWire, SessionWire } from "../../shared/types.ts";
import { InvitesTable, SessionsTable } from "./access-tables.tsx";
import { ExternalAccessSection } from "./ExternalAccessSection.tsx";
import { hint, subsectionHeader } from "./AccessPaneShared.tsx";
import { IssueInviteForm } from "./IssueInviteForm.tsx";
import { RecoveryInviteForm } from "./RecoveryInviteForm.tsx";
export { InvitesTable, SessionsTable } from "./access-tables.tsx";

export function AccessPane() {
  const { invitesList, invitesLoaded, activeSessions, activeSessionsLoaded } = useAppState();
  // Holds the most recent server-side lockout-prevention rejection so the
  // banner stays visible until the user dismisses or retries. Cleared on
  // any successful state change (which we proxy via activeSessions length
  // change — a successful revoke shrinks the list).
  const [blockedNote, setBlockedNote] = useState<string | null>(null);
  const prevSessionsLenRef = useRef<number>(activeSessions.length);

  // Lazily fetch the owner-only lists. The session_context reducer resets
  // both loaded flags on every WS open (including reconnects), so this
  // effect re-runs and keeps the lists fresh across socket bounces.
  useEffect(() => {
    if (!invitesLoaded) send({ type: "list_invites" });
    if (!activeSessionsLoaded) send({ type: "list_active_sessions" });
  }, [invitesLoaded, activeSessionsLoaded]);

  // Listen for the server's lockout-prevention rejections.
  useEffect(() => {
    const fn = (data: string) => {
      try {
        const m = JSON.parse(data);
        if (m.type === "revoke_blocked" && typeof m.reason === "string") {
          setBlockedNote(m.reason);
        }
      } catch {}
    };
    addRawListener(fn);
    return () => removeRawListener(fn);
  }, []);

  // Auto-clear the banner on any successful active-session change.
  useEffect(() => {
    const prev = prevSessionsLenRef.current;
    const curr = activeSessions.length;
    prevSessionsLenRef.current = curr;
    if (curr < prev) setBlockedNote(null);
  }, [activeSessions.length]);

  return (
    <div style={{ marginTop: 24 }}>
      <h4 style={sectionHeader}>Access</h4>
      <p style={hint}>Add owners and members here by issuing invite URLs and sending them to the recipient. Toggle external access if you want this office reachable from outside the host machine.</p>

      {blockedNote && (
        <div style={blockedBox}>
          <span style={{ flex: 1 }}>{blockedNote}</span>
          <button
            onClick={() => setBlockedNote(null)}
            style={{
              background: "transparent",
              border: "none",
              color: "#ff6b6b",
              cursor: "pointer",
              fontSize: 14,
              padding: 0,
            }}
            title="Dismiss"
          >
            ×
          </button>
        </div>
      )}

      <ExternalAccessSection />

      <IssueInviteForm />

      <h5 style={subsectionHeader}>Recovery links</h5>
      <RecoveryInviteForm />

      <h5 style={subsectionHeader}>Outstanding invites</h5>
      {renderListSection(invitesList, invitesLoaded, (rows) => (
        <InvitesTable invites={rows} />
      ))}

      <h5 style={subsectionHeader}>Active sessions</h5>
      {renderListSection(activeSessions, activeSessionsLoaded, (rows) => (
        <SessionsTable sessions={rows} />
      ))}
    </div>
  );
}

// Render the cached rows whenever any are present, even while a refresh is
// in flight — avoids a flicker to "Loading…" on every reconnect.
export function renderListSection<T>(rows: T[], loaded: boolean, renderTable: (rows: T[]) => React.ReactNode): React.ReactNode {
  if (rows.length > 0) return renderTable(rows);
  if (!loaded) return <p style={hint}>Loading…</p>;
  return <p style={hint}>None.</p>;
}

export const sectionHeader: React.CSSProperties = {
  fontSize: 14,
  fontWeight: 700,
  margin: "0 0 4px",
  color: "var(--text-primary)",
};
const blockedBox: React.CSSProperties = {
  margin: "8px 0",
  padding: "8px 12px",
  border: "1px solid #ff6b6b",
  borderRadius: 6,
  background: "rgba(255,107,107,0.08)",
  fontSize: 12,
  color: "#ff6b6b",
  display: "flex",
  gap: 8,
  alignItems: "flex-start",
};
