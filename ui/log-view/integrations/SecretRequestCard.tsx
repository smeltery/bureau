import { useEffect, useState } from "react";
import type { SecretRequestCard as RequestCard, SecretRequestStatus } from "../../../shared/integrations/secret-requests.ts";
import { dialogCancelBtn, dialogHint, dialogInput, dialogLabel, dialogSaveBtn } from "../../components/modals/dialog-styles.ts";
import { integrationApi } from "../../components/integrations/scoped/api.ts";
export function SecretRequestCard({ card }: { card: RequestCard }) {
  const [status, setStatus] = useState<SecretRequestStatus>("pending");
  const [canAnswer, setCanAnswer] = useState(false);
  const [value, setValue] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
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
          setError("Could not check this credential request. Retry before saving.");
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
      setError(caught instanceof Error ? caught.message : "Could not answer this request.");
    } finally {
      setPending(false);
    }
  }
  return (
    <section aria-label={`Credential request: ${card.name}`} style={{ margin: "8px 0", padding: 14, border: "1px solid var(--border)", borderRadius: 10, background: "var(--bg-subtle)" }}>
      <strong style={{ overflowWrap: "anywhere" }}>Credential request · {card.name}</strong>
      <p style={dialogHint}>{card.reason}</p>
      <p style={{ ...dialogHint, overflowWrap: "anywhere" }}>
        Scope: {card.scope.kind === "office" ? "Office · shared by all agents" : "Requesting agent's member"}
        <br />
        Allowed HTTPS hosts: {card.hosts.join(", ")}
        <br />
        Header: {card.form.kind === "authorization" ? "Authorization" : card.form.header}
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
              Secret value
              <input required type="password" autoComplete="new-password" spellCheck={false} disabled={pending} value={value} onChange={(event) => setValue(event.target.value)} style={dialogInput} />
            </label>
            <p style={dialogHint}>
              Saved directly to the secret store, never posted in chat. The agent receives a stand-in. Only approve hosts you trust. This does not isolate the value from programs running as the same
              OS user.
            </p>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
              <button disabled={pending || !value} style={dialogSaveBtn}>
                {pending ? "Saving…" : "Save credential"}
              </button>
              <button type="button" disabled={pending} style={dialogCancelBtn} onClick={() => void answer(true)}>
                Decline
              </button>
            </div>
          </form>
        ) : (
          <p role="status" style={dialogHint}>
            Waiting for the responsible member to answer.
          </p>
        )
      ) : (
        <p role="status" style={dialogHint}>
          {status === "saved"
            ? "Credential saved. Its value was not sent in chat."
            : status === "declined"
              ? "Credential request declined."
              : "This request is closed. Ask the agent to create a new one if needed."}
        </p>
      )}
      {deliveryNote && <p style={dialogHint}>The agent could not be notified automatically. Send it a message when you are ready to continue.</p>}
      {error && (
        <div role="alert">
          <p>{error}</p>
          <button
            type="button"
            style={dialogCancelBtn}
            onClick={() => {
              setError(null);
              setRevision((number) => number + 1);
            }}
          >
            Retry status
          </button>
        </div>
      )}
    </section>
  );
}
