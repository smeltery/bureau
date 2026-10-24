import { useI18n } from "../i18n.tsx";
// Owner-only Access section: external reachability for the office.
// Invite links and active sessions live in their own settings panes.

import type { InviteWire, SessionWire } from "../../shared/types.ts";
import { InvitesTable, SessionsTable } from "./access-tables.tsx";
import { ExternalAccessSection } from "./ExternalAccessSection.tsx";
import { hint } from "./AccessPaneShared.tsx";
export { InvitesTable, SessionsTable } from "./access-tables.tsx";

export function AccessPane({ onDirtyChange }: { onDirtyChange?: (dirty: boolean) => void }) {
  const { t } = useI18n();
  return (
    <div style={{ marginTop: 24 }}>
      <h4 style={sectionHeader}>{t("access.title")}</h4>
      <p style={hint}>{t("externalUi.hint")}</p>

      <ExternalAccessSection onDirtyChange={onDirtyChange} />
    </div>
  );
}

// Render the cached rows whenever any are present, even while a refresh is
// in flight — avoids a flicker to "Loading…" on every reconnect.
export function renderListSection<T>(rows: T[], loaded: boolean, renderTable: (rows: T[]) => React.ReactNode): React.ReactNode {
  if (rows.length > 0) return <div style={{ maxWidth: "100%", overflowX: "auto" }}>{renderTable(rows)}</div>;
  return <ListEmpty loaded={loaded} />;
}

function ListEmpty({ loaded }: { loaded: boolean }) {
  const { t } = useI18n();
  return <p style={hint}>{t(loaded ? "common.none" : "common.loading")}</p>;
}

export const sectionHeader: React.CSSProperties = {
  fontSize: 14,
  fontWeight: 700,
  margin: "0 0 4px",
  color: "var(--text-primary)",
};
