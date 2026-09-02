import { dialogCancelBtn } from "./modals/dialog-styles.ts";
import { sectionHeader } from "./AccessPane.tsx";

export function SignOutPane() {
  return (
    <div style={{ marginTop: 24 }}>
      <h4 style={sectionHeader}>Sign out</h4>
      <p style={{ fontSize: 11, margin: "5px 0 8px", color: "var(--text-ghost)" }}>Sign out of this device. Other devices for the same user stay signed in.</p>
      <form method="POST" action="/auth/logout" style={{ margin: 0 }}>
        <button type="submit" style={dialogCancelBtn}>
          Sign out
        </button>
      </form>
    </div>
  );
}
