// Owner-only Access section: external reachability for the office.
// Invite links and active sessions live in their own settings panes.

import type { InviteWire, SessionWire } from "../../shared/types.ts";
import { InvitesTable, SessionsTable } from "./access-tables.tsx";
import { ExternalAccessSection } from "./ExternalAccessSection.tsx";
import { hint } from "./AccessPaneShared.tsx";
export { InvitesTable, SessionsTable } from "./access-tables.tsx";

export function AccessPane({ onDirtyChange }: { onDirtyChange?: (dirty: boolean) => void }) {
  return (
    <div style={{ marginTop: 24 }}>
      <h4 style={sectionHeader}>Access</h4>
      <p style={hint}>Control whether this office is reachable from outside the host machine. Invite links and signed-in devices live in Invites and Sessions.</p>

      <ExternalAccessSection onDirtyChange={onDirtyChange} />
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
