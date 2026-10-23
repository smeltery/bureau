import { useI18n } from "../../../i18n.tsx";
import { useEffect, useState } from "react";
import { dialogCancelBtn, dialogHint, dialogInput, dialogLabel, dialogSaveBtn } from "../../modals/dialog-styles.ts";
import { integrationFailure, integrationFailureText, type IntegrationFailure, integrationApi } from "./api.ts";
export function McpSignIn({ path }: { path: string }) {
  const { t } = useI18n();
  const [connected, setConnected] = useState<boolean | null>(null);
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [authorizationUrl, setAuthorizationUrl] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<IntegrationFailure | null>(null);
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
        if (active) setError({ key: "integrations.mcpStatusFailed" });
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
      setError(integrationFailure(caught, "integrations.mcpStartFailed"));
    } finally {
      setPending(false);
    }
  }
  return (
    <div style={{ marginTop: 12 }}>
      <p role="status" style={dialogHint}>
        {connected === null ? t("integrations.mcpChecking") : connected ? t("integrations.mcpConnected") : t("integrations.mcpRequired")}
      </p>
      {error && <p role="alert">{integrationFailureText(error, t)}</p>}
      {authorizationUrl ? (
        <p style={dialogHint}>
          <a href={authorizationUrl} target="_blank" rel="noopener noreferrer">
            {t("integrations.mcpContinue")}
          </a>
          . {t("integrations.mcpReturn")}
        </p>
      ) : (
        <>
          {!connected && (
            <details>
              <summary>{t("integrations.oauthClient")}</summary>
              <p style={dialogHint}>{t("integrations.oauthClientHint", { callback: "/api/integrations/oauth/callback" })}</p>
              <label style={dialogLabel}>
                {t("integrations.clientId")}
                <input autoComplete="off" style={dialogInput} value={clientId} onChange={(e) => setClientId(e.target.value)} />
              </label>
              <label style={dialogLabel}>
                {t("integrations.clientSecret")}
                <input type="password" autoComplete="new-password" style={dialogInput} value={clientSecret} onChange={(e) => setClientSecret(e.target.value)} />
              </label>
            </details>
          )}
          <button style={dialogSaveBtn} disabled={pending} onClick={() => void start()}>
            {pending ? t("integrations.starting") : connected ? t("integrations.signInAgain") : t("integrations.signIn")}
          </button>
        </>
      )}
      <button style={dialogCancelBtn} disabled={pending} onClick={() => setRevision((value) => value + 1)}>
        {t("integrations.refreshStatus")}
      </button>
      {connected && (
        <button style={dialogCancelBtn} disabled={pending} onClick={() => setConfirmSignOut(true)}>
          {t("common.signOut")}
        </button>
      )}
      {confirmSignOut && (
        <div>
          <p style={dialogHint}>{t("integrations.signOutHint")}</p>
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
                setError(integrationFailure(caught, "integrations.signOutFailed"));
              } finally {
                setPending(false);
              }
            }}
          >
            {t("integrations.confirmSignOut")}
          </button>
          <button style={dialogCancelBtn} disabled={pending} onClick={() => setConfirmSignOut(false)}>
            {t("common.cancel")}
          </button>
        </div>
      )}
    </div>
  );
}
