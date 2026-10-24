import { useI18n } from "../../i18n.tsx";
import { useEffect, useState } from "react";
import type { SecretRequestCard as RequestCard, SecretRequestStatus } from "../../../shared/integrations/secret-requests.ts";
import { dialogCancelBtn, dialogHint, dialogInput, dialogLabel, dialogSaveBtn } from "../../components/modals/dialog-styles.ts";
import { integrationApi, integrationFailure, integrationFailureText, type IntegrationFailure } from "../../components/integrations/scoped/api.ts";
export function SecretRequestCard({ card }: { card: RequestCard }) {
  const { t } = useI18n();
  const [status, setStatus] = useState<SecretRequestStatus>("pending");
  const [canAnswer, setCanAnswer] = useState(false);
  const [value, setValue] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<IntegrationFailure | null>(null);
  const [deliveryNote, setDeliveryNote] = useState(false);
  const [revision, setRevision] = useState(0);
  const path = `/api/integrations/requests/${card.id}`;
  useEffect(() => {
    let active = true;
    async function refresh() {
      try {
        const response = await fetch(path, { credentials: "same-origin" });
        if (!active) return;
        if (response.status === 404) {
          setStatus("closed");
          setValue("");
          return;
        }
        if (!response.ok) throw new Error("Could not check this credential request.");
        const result = await response.json();
        if (!active) return;
        setStatus(result.status);
        setCanAnswer(result.canAnswer);
        if (result.status !== "pending") setValue("");
      } catch {
        if (active) {
          setCanAnswer(false);
          setError({ key: "credentials.checkFailed" });
        }
      }
    }
    void refresh();
    const timer = status === "pending" ? setInterval(() => void refresh(), 10000) : undefined;
    window.addEventListener("focus", refresh);
    return () => {
      active = false;
      clearInterval(timer);
      window.removeEventListener("focus", refresh);
    };
  }, [path, status, revision]);
  async function answer(decline: boolean) {
    setPending(true);
    setError(null);
    try {
      const result = await integrationApi<{ status: SecretRequestStatus; delivered: boolean }>(path, "POST", decline ? { decline: true } : { value });
      setValue("");
      setStatus(result.status);
      setDeliveryNote(!result.delivered);
    } catch (caught) {
      setError(caught instanceof TypeError || caught instanceof SyntaxError ? { key: "credentials.answerFailed" } : integrationFailure(caught, "credentials.answerFailed"));
    } finally {
      setPending(false);
    }
  }
  return (
    <section aria-label={t("credentials.label", { name: card.name })} style={{ margin: "8px 0", padding: 14, border: "1px solid var(--border)", borderRadius: 10, background: "var(--bg-subtle)" }}>
      <strong style={{ overflowWrap: "anywhere" }}>{t("credentials.title", { name: card.name })}</strong>
      <p style={dialogHint}>{card.reason}</p>
      <p style={{ ...dialogHint, overflowWrap: "anywhere" }}>
        {t("credentials.scope", { scope: t(card.scope.kind === "office" ? "credentials.office" : "credentials.member") })}
        <br />
        {t("credentials.hosts", { hosts: card.hosts.join(", ") })}
        <br />
        {t("credentials.header", { header: card.form.kind === "authorization" ? "Authorization" : card.form.header })}
      </p>
      {status === "pending" ? (
        canAnswer ? (
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void answer(false);
            }}
          >
            <label style={dialogLabel}>
              {t("credentials.value")}
              <input required type="password" autoComplete="new-password" spellCheck={false} disabled={pending} value={value} onChange={(event) => setValue(event.target.value)} style={dialogInput} />
            </label>
            <p style={dialogHint}>{t("credentials.hint")}</p>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
              <button disabled={pending || !value} style={dialogSaveBtn}>
                {t(pending ? "credentials.saving" : "credentials.save")}
              </button>
              <button type="button" disabled={pending} style={dialogCancelBtn} onClick={() => void answer(true)}>
                {t("credentials.decline")}
              </button>
            </div>
          </form>
        ) : (
          <p role="status" style={dialogHint}>
            {t("credentials.waiting")}
          </p>
        )
      ) : (
        <p role="status" style={dialogHint}>
          {status === "saved" ? t("credentials.saved") : status === "declined" ? t("credentials.declined") : t("credentials.closed")}
        </p>
      )}
      {deliveryNote && <p style={dialogHint}>{t("credentials.deliveryNote")}</p>}
      {error && (
        <div role="alert">
          <p>{integrationFailureText(error, t)}</p>
          <button
            type="button"
            style={dialogCancelBtn}
            onClick={() => {
              setError(null);
              setRevision((number) => number + 1);
            }}
          >
            {t("credentials.retry")}
          </button>
        </div>
      )}
    </section>
  );
}
