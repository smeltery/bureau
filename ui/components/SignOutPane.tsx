import { useAppState } from "../store.tsx";
import { dialogCancelBtn } from "./modals/dialog-styles.ts";
import { sectionHeader } from "./AccessPane.tsx";

export function signOutEnabled(hasSession: boolean): boolean {
  return hasSession;
}

export function SignOutPane() {
  const { sessionContext } = useAppState();
  const enabled = signOutEnabled(!!sessionContext);
  return (
    <div style={{ marginTop: 24 }}>
      <h4 style={sectionHeader}>Sign out</h4>
      <p style={{ fontSize: 11, margin: "5px 0 8px", color: "var(--text-ghost)" }}>Sign out of this device. Other devices for the same user stay signed in.</p>
      <form method="POST" action="/auth/logout" style={{ margin: 0 }}>
        <button
          type="submit"
          disabled={!enabled}
          style={{
            ...dialogCancelBtn,
            ...(enabled ? {} : { color: "var(--text-ghost)", cursor: "not-allowed", opacity: 0.55 }),
          }}
        >
          Sign out
        </button>
      </form>
    </div>
  );
}
