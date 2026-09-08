import { ManagedEnvEditor } from "./modals/ManagedEnvEditor.tsx";
import { sectionHeader } from "./AccessPane.tsx";

/** First-class Account sidebar entry for the signed-in user's managed env. */
export function PersonalVariablesPane({ username }: { username: string }) {
  return (
    <div style={{ marginTop: 24 }}>
      <h4 style={sectionHeader}>Variables</h4>
      <p style={{ fontSize: 11, margin: "5px 0 12px", color: "var(--text-ghost)" }}>Variables loaded by agents you spawn. When the same name exists as an office variable, yours wins.</p>
      <ManagedEnvEditor path={`/api/users/${encodeURIComponent(username)}/env`} />
    </div>
  );
}
