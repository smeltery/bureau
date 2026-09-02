import { ManagedEnvEditor } from "./modals/ManagedEnvEditor.tsx";
import { sectionHeader } from "./AccessPane.tsx";

export function OfficeVariablesPane() {
  return (
    <div style={{ marginTop: 24 }}>
      <h4 style={sectionHeader}>Office variables</h4>
      <p style={{ fontSize: 11, margin: "5px 0 12px", color: "var(--text-ghost)" }}>Variables loaded by every agent and cron job unless a user variable overrides them.</p>
      <ManagedEnvEditor path="/api/office/env" />
    </div>
  );
}
