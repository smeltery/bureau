import { useEffect, useRef, useState } from "react";
import type { ProviderAccountProvider, ProviderAccountScope, ProviderSignInStatus } from "../../../shared/provider-accounts.ts";
import { useAppState } from "../../store.tsx";
import { integrationApi } from "../integrations/scoped/api.ts";
import { dialogCancelBtn, dialogHint, dialogInput, dialogLabel, dialogSaveBtn } from "../modals/dialog-styles.ts";

export function ProviderSignIn({ provider, onChanged }: { provider: ProviderAccountProvider; onChanged(): void }) {
  const { sessionContext } = useAppState();
  const [scope, setScope] = useState<ProviderAccountScope>("personal");
  const [status, setStatus] = useState<ProviderSignInStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [code, setCode] = useState("");
  const [confirm, setConfirm] = useState(false);
  const generation = useRef(0);
  const changed = useRef(onChanged);
  changed.current = onChanged;
  const currentStatus = useRef(status);
  currentStatus.current = status;
  const title = provider === "claude" ? "Claude" : "Codex";
  const path = `/api/me/provider-accounts/${provider}/login?scope=${scope}`;
  const canManage = scope === "personal" || sessionContext?.role === "owner";
  useEffect(() => {
    const ticket = ++generation.current;
    setStatus(null);
    setError(null);
    setCode("");
    setConfirm(false);
    setPending(false);
    let timer: ReturnType<typeof setTimeout>;
    async function poll() {
      try {
        const next = await integrationApi<ProviderSignInStatus>(path);
        if (generation.current !== ticket) return;
        if (currentStatus.current?.phase !== "idle" && currentStatus.current?.phase && next.phase === "idle") changed.current();
        currentStatus.current = next;
        setStatus(next);
      } catch (caught) {
        if (generation.current === ticket) setError(caught instanceof Error ? caught.message : "Could not check provider sign-in.");
      }
      if (generation.current === ticket) timer = setTimeout(poll, 2000);
    }
    void poll();
    return () => {
      generation.current++;
      clearTimeout(timer);
    };
  }, [path, sessionContext?.userId]);
  async function action(method: string, body: unknown, disconnect = false) {
    if (pending) return;
    const ticket = generation.current;
    setPending(true);
    setError(null);
    try {
      const next = await integrationApi<ProviderSignInStatus>(disconnect ? `/api/me/provider-accounts/${provider}/disconnect?scope=${scope}` : path, method, body);
      if (generation.current !== ticket) return;
      setStatus(next);
      currentStatus.current = next;
      setCode("");
      setConfirm(false);
      if (next.phase === "idle") changed.current();
    } catch (caught) {
      if (generation.current === ticket) setError(caught instanceof Error ? caught.message : "Provider sign-in failed.");
    } finally {
      if (generation.current === ticket) setPending(false);
    }
  }
  const active = status && status.phase !== "idle";
  return (
    <section aria-label={`${title} browser sign-in`} style={{ marginTop: 12, borderTop: "1px solid var(--border)", paddingTop: 12 }}>
      <label style={dialogLabel}>
        Account scope
        <select aria-label={`${title} account scope`} style={dialogInput} value={scope} disabled={pending} onChange={(event) => setScope(event.target.value as ProviderAccountScope)}>
          <option value="personal">Personal · your agents</option>
          <option value="office">Office · shared account</option>
        </select>
      </label>
      <p style={dialogHint}>
        {status ? (status.connected ? `Signed in${status.label ? ` as ${status.label}` : ""}.` : "No saved subscription sign-in in this scope.") : "Checking subscription sign-in…"}
      </p>
      {scope === "personal" && (
        <p style={dialogHint}>
          A private account directory becomes active after sign-in is verified. Existing conversations keep their original account directory; start a new conversation to use this account.
        </p>
      )}
      {scope === "personal" && status?.connected && !status.activePersonal && status.managed && <p style={dialogHint}>This saved account is not active. Sign in again to verify and activate it.</p>}
      {status?.apiKeyPresent && <p style={dialogHint}>An API key is also configured. Provider credential precedence still applies; signing in does not remove that key.</p>}
      {!canManage && <p style={dialogHint}>Only an owner can change the shared office account.</p>}
      {active ? (
        <>
          <p role="status" style={dialogHint}>
            {status.holderName ? `${status.holderName}: ` : ""}
            {status.phase === "waiting"
              ? "Waiting for provider sign-in."
              : status.phase === "verifying"
                ? "Verifying saved account…"
                : status.phase === "cancelling"
                  ? "Cancelling sign-in…"
                  : "Starting sign-in…"}
          </p>
          {status.authUrl && (
            <p>
              <a href={status.authUrl} target="_blank" rel="noopener noreferrer">
                Continue {title} sign-in
              </a>
            </p>
          )}
          {status.userCode && (
            <p style={dialogHint}>
              Enter this device code: <code style={{ userSelect: "all" }}>{status.userCode}</code>
            </p>
          )}
          {provider === "claude" && status.authUrl && status.phase === "waiting" && (
            <form
              onSubmit={(event) => {
                event.preventDefault();
                void action("PUT", { operationId: status.operationId, code });
              }}
            >
              <label style={dialogLabel}>
                Paste the code from the provider tab
                <input aria-label="Claude sign-in code" type="password" autoComplete="off" style={dialogInput} value={code} onChange={(event) => setCode(event.target.value)} />
              </label>
              <button style={dialogSaveBtn} disabled={pending || !code.trim()}>
                Complete sign-in
              </button>
            </form>
          )}
          {canManage && (
            <button style={dialogCancelBtn} disabled={pending || status.phase === "cancelling"} onClick={() => void action("DELETE", { operationId: status.operationId })}>
              Cancel sign-in
            </button>
          )}
        </>
      ) : (
        canManage && (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            <button style={dialogSaveBtn} disabled={pending} onClick={() => void action("POST", { method: provider === "codex" ? "device" : "browser" })}>
              {pending ? "Working…" : provider === "codex" ? "Sign in with device code" : "Sign in with browser"}
            </button>
            {provider === "codex" && (
              <button style={dialogCancelBtn} disabled={pending} onClick={() => void action("POST", { method: "browser" })}>
                Browser sign-in on this host
              </button>
            )}
            {(status?.connected || status?.activePersonal) && (
              <button style={dialogCancelBtn} disabled={pending} onClick={() => setConfirm(true)}>
                Disconnect
              </button>
            )}
          </div>
        )
      )}
      {provider === "codex" && <p style={dialogHint}>Device codes work from another computer or phone. Browser sign-in requires the browser to reach the Bureau host’s localhost callback.</p>}
      {confirm && (
        <div role="group" aria-label="Confirm provider disconnect">
          <p style={dialogHint}>
            Disconnect the {scope} {title} subscription?{" "}
            {scope === "office" ? "Agents using the shared account may need a new sign-in." : "New conversations will return to office defaults. Existing conversations keep their directory."} API keys
            remain configured.
          </p>
          <button style={dialogCancelBtn} disabled={pending} onClick={() => setConfirm(false)}>
            Keep connected
          </button>
          <button style={dialogSaveBtn} disabled={pending} onClick={() => void action("POST", { confirm: "DISCONNECT" }, true)}>
            Confirm disconnect
          </button>
        </div>
      )}
      {(error || status?.error) && (
        <p role="alert" style={{ color: "var(--red)", fontSize: 12 }}>
          {error || status?.error}
        </p>
      )}
    </section>
  );
}
