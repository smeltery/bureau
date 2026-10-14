import { useEffect, useState } from "react";
import { dialogCancelBtn, dialogHint, dialogInput, dialogLabel, dialogSaveBtn } from "../../modals/dialog-styles.ts";
import { integrationApi } from "./api.ts";
export function McpSignIn({ path }: { path: string }) {
  const [connected, setConnected] = useState<boolean | null>(null);
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [authorizationUrl, setAuthorizationUrl] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmSignOut, setConfirmSignOut] = useState(false);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    let active = true;
    async function status() {
      try {
        const result = await integrationApi<{ connected: boolean }>(`${path}/sign-in-status`);
        if (active) {
          setConnected(result.connected);
          if (result.connected) setAuthorizationUrl(null);
        }
      } catch {
        if (active) setError("Could not check sign-in status. Refresh to retry.");
      }
    }
    void status();
    window.addEventListener("focus", status);
    const timer = authorizationUrl ? setInterval(() => void status(), 5000) : undefined;
    return () => {
      active = false;
      clearInterval(timer);
      window.removeEventListener("focus", status);
    };
  }, [path, revision, authorizationUrl]);
  async function start() {
    setPending(true);
    setError(null);
    try {
      const result = await integrationApi<{ authorizationUrl: string }>(`${path}/sign-in`, "POST", { ...(clientId ? { clientId } : {}), ...(clientSecret ? { clientSecret } : {}) });
      setClientSecret("");
      setAuthorizationUrl(result.authorizationUrl);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not start sign-in.");
    } finally {
      setPending(false);
    }
  }
  return (
    <div style={{ marginTop: 12 }}>
      <p role="status" style={dialogHint}>
        {connected === null ? "Checking sign-in…" : connected ? "Browser sign-in connected · shared across engines" : "Browser sign-in required"}
      </p>
      {error && <p role="alert">{error}</p>}
      {authorizationUrl ? (
        <p style={dialogHint}>
          <a href={authorizationUrl} target="_blank" rel="noopener noreferrer">
            Continue sign-in in a new tab
          </a>
          . Return here after authorizing; status updates automatically.
        </p>
      ) : (
        <>
          {!connected && (
            <details>
              <summary>Use a pre-registered OAuth client</summary>
              <p style={dialogHint}>
                Usually the server registers Bureau automatically. If it requires an existing client, use its client ID and optional secret. Configure the callback as your Bureau origin followed by
                /api/integrations/oauth/callback.
              </p>
              <label style={dialogLabel}>
                Client ID
                <input autoComplete="off" style={dialogInput} value={clientId} onChange={(e) => setClientId(e.target.value)} />
              </label>
              <label style={dialogLabel}>
                Client secret (optional)
                <input type="password" autoComplete="new-password" style={dialogInput} value={clientSecret} onChange={(e) => setClientSecret(e.target.value)} />
              </label>
            </details>
          )}
          <button style={dialogSaveBtn} disabled={pending} onClick={() => void start()}>
            {pending ? "Starting…" : connected ? "Sign in again" : "Sign in"}
          </button>
        </>
      )}
      <button style={dialogCancelBtn} disabled={pending} onClick={() => setRevision((value) => value + 1)}>
        Refresh status
      </button>
      {connected && (
        <button style={dialogCancelBtn} disabled={pending} onClick={() => setConfirmSignOut(true)}>
          Sign out
        </button>
      )}
      {confirmSignOut && (
        <div>
          <p style={dialogHint}>Remove Bureau's saved tokens for this connection? Provider-side consent may need to be revoked separately.</p>
          <button
            style={dialogSaveBtn}
            disabled={pending}
            onClick={async () => {
              setPending(true);
              setError(null);
              try {
                await integrationApi(`${path}/sign-out`, "DELETE");
                setConfirmSignOut(false);
                setAuthorizationUrl(null);
                setRevision((value) => value + 1);
              } catch (caught) {
                setError(caught instanceof Error ? caught.message : "Could not sign out.");
              } finally {
                setPending(false);
              }
            }}
          >
            Confirm sign out
          </button>
          <button style={dialogCancelBtn} disabled={pending} onClick={() => setConfirmSignOut(false)}>
            Cancel
          </button>
        </div>
      )}
    </div>
  );
}
