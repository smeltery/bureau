import { useI18n } from "../../i18n.tsx";
import { useEffect, useRef, useState } from "react";
import type { ProviderAccountProvider, ProviderAccountScope, ProviderSignInStatus } from "../../../shared/provider-accounts.ts";
import { useAppState } from "../../store.tsx";
import { integrationApi } from "../integrations/scoped/api.ts";
import { dialogCancelBtn, dialogHint, dialogInput, dialogLabel, dialogSaveBtn } from "../modals/dialog-styles.ts";

export function ProviderSignIn({ provider, onChanged }: { provider: ProviderAccountProvider; onChanged(): void }) {
  const { t } = useI18n();
  const { sessionContext } = useAppState();
  const [scope, setScope] = useState<ProviderAccountScope>("personal");
  const [status, setStatus] = useState<ProviderSignInStatus | null>(null);
  const [error, setError] = useState<string | { key: "providerSignIn.checkFailed" | "providerSignIn.failed" } | null>(null);
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
        if (generation.current === ticket) setError(caught instanceof Error ? caught.message : { key: "providerSignIn.checkFailed" });
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
      if (generation.current === ticket) setError(caught instanceof Error ? caught.message : { key: "providerSignIn.failed" });
    } finally {
      if (generation.current === ticket) setPending(false);
    }
  }
  const active = status && status.phase !== "idle";
  return (
    <section aria-label={t("providerSignIn.title", { provider: title })} style={{ marginTop: 12, borderTop: "1px solid var(--border)", paddingTop: 12 }}>
      <label style={dialogLabel}>
        {t("providerSignIn.scope")}
        <select
          aria-label={t("providerSignIn.providerScope", { provider: title })}
          style={dialogInput}
          value={scope}
          disabled={pending}
          onChange={(event) => setScope(event.target.value as ProviderAccountScope)}
        >
          <option value="personal">{t("providerSignIn.personal")}</option>
          <option value="office">{t("providerSignIn.office")}</option>
        </select>
      </label>
      <p style={dialogHint}>
        {status
          ? status.connected
            ? status.label
              ? t("providerSignIn.signedInAs", { label: status.label })
              : t("providerSignIn.signedIn")
            : t("providerSignIn.noAccount")
          : t("providerSignIn.checking")}
      </p>
      {scope === "personal" && <p style={dialogHint}>{t("providerSignIn.personalHint")}</p>}
      {scope === "personal" && status?.connected && !status.activePersonal && status.managed && <p style={dialogHint}>{t("providerSignIn.inactive")}</p>}
      {status?.apiKeyPresent && <p style={dialogHint}>{t("providerSignIn.apiKeyHint")}</p>}
      {!canManage && <p style={dialogHint}>{t("providerSignIn.ownerOnly")}</p>}
      {active ? (
        <>
          <p role="status" style={dialogHint}>
            {status.holderName ? `${status.holderName}: ` : ""}
            {status.phase === "waiting"
              ? t("providerSignIn.waiting")
              : status.phase === "verifying"
                ? t("providerSignIn.verifying")
                : status.phase === "cancelling"
                  ? t("providerSignIn.cancelling")
                  : t("providerSignIn.starting")}
          </p>
          {status.authUrl && (
            <p>
              <a href={status.authUrl} target="_blank" rel="noopener noreferrer">
                {t("providerSignIn.continue", { provider: title })}
              </a>
            </p>
          )}
          {status.userCode && (
            <p style={dialogHint}>
              {t("providerSignIn.deviceCode")} <code style={{ userSelect: "all" }}>{status.userCode}</code>
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
                {t("providerSignIn.pasteCode")}
                <input aria-label={t("providerSignIn.codeLabel")} type="password" autoComplete="off" style={dialogInput} value={code} onChange={(event) => setCode(event.target.value)} />
              </label>
              <button style={dialogSaveBtn} disabled={pending || !code.trim()}>
                {t("providerSignIn.complete")}
              </button>
            </form>
          )}
          {canManage && (
            <button style={dialogCancelBtn} disabled={pending || status.phase === "cancelling"} onClick={() => void action("DELETE", { operationId: status.operationId })}>
              {t("providerSignIn.cancel")}
            </button>
          )}
        </>
      ) : (
        canManage && (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            <button style={dialogSaveBtn} disabled={pending} onClick={() => void action("POST", { method: provider === "codex" ? "device" : "browser" })}>
              {pending ? t("providerSignIn.working") : provider === "codex" ? t("providerSignIn.device") : t("providerSignIn.browser")}
            </button>
            {provider === "codex" && (
              <button style={dialogCancelBtn} disabled={pending} onClick={() => void action("POST", { method: "browser" })}>
                {t("providerSignIn.hostBrowser")}
              </button>
            )}
            {(status?.connected || status?.activePersonal) && (
              <button style={dialogCancelBtn} disabled={pending} onClick={() => setConfirm(true)}>
                {t("providerSignIn.disconnect")}
              </button>
            )}
          </div>
        )
      )}
      {provider === "codex" && <p style={dialogHint}>{t("providerSignIn.deviceHint")}</p>}
      {confirm && (
        <div role="group" aria-label={t("providerSignIn.confirmLabel")}>
          <p style={dialogHint}>{t(scope === "office" ? "providerSignIn.disconnectOffice" : "providerSignIn.disconnectPersonal", { provider: title })}</p>
          <button style={dialogCancelBtn} disabled={pending} onClick={() => setConfirm(false)}>
            {t("providerSignIn.keep")}
          </button>
          <button style={dialogSaveBtn} disabled={pending} onClick={() => void action("POST", { confirm: "DISCONNECT" }, true)}>
            {t("providerSignIn.confirm")}
          </button>
        </div>
      )}
      {(error || status?.error) && (
        <p role="alert" style={{ color: "var(--red)", fontSize: 12 }}>
          {error ? (typeof error === "string" ? error : t(error.key)) : status?.error}
        </p>
      )}
    </section>
  );
}
