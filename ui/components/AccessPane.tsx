// Owner-only Access section: issue invites, manage outstanding invite links,
// and toggle external access. Active sessions live in SessionsPane.

import { useEffect } from "react";
import { useAppState } from "../store.tsx";
import { send } from "../ws.ts";
import type { InviteWire, SessionWire } from "../../shared/types.ts";
import { InvitesTable, SessionsTable } from "./access-tables.tsx";
import { ExternalAccessSection } from "./ExternalAccessSection.tsx";
import { hint, subsectionHeader } from "./AccessPaneShared.tsx";
import { IssueInviteForm } from "./IssueInviteForm.tsx";
import { RecoveryInviteForm } from "./RecoveryInviteForm.tsx";
export { InvitesTable, SessionsTable } from "./access-tables.tsx";

export function AccessPane() {
  const { invitesList, invitesLoaded } = useAppState();

  // Lazily fetch the owner-only lists. The session_context reducer resets
  // both loaded flags on every WS open (including reconnects), so this
  // effect re-runs and keeps the lists fresh across socket bounces.
  useEffect(() => {
    if (!invitesLoaded) send({ type: "list_invites" });
  }, [invitesLoaded]);

  return (
    <div style={{ marginTop: 24 }}>
      <h4 style={sectionHeader}>Access</h4>
      <p style={hint}>
        Add owners and members here by issuing invite URLs and sending them to the recipient. Toggle external access if you want this office reachable from outside the host machine. Signed-in devices
        live in Sessions.
      </p>

      <ExternalAccessSection />

      <IssueInviteForm />

      <h5 style={subsectionHeader}>Recovery links</h5>
      <RecoveryInviteForm />

      <h5 style={subsectionHeader}>Outstanding invites</h5>
      {renderListSection(invitesList, invitesLoaded, (rows) => (
        <InvitesTable invites={rows} />
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
