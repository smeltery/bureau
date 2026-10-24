import { useI18n } from "../i18n.tsx";
import { auditRequest, auditFailure, auditFailureText, type AuditFailure } from "./api.ts";
import { RecordingsPane } from "./recordings/RecordingsPane.tsx";
import { useEffect, useState } from "react";
import type { AuditPage } from "../../shared/integrations/audit.ts";

const OUTCOME_KEYS = { pending: "auditUi.pending", committed: "auditUi.committed", failed: "auditUi.failed" } as const;
const SCOPE_KEYS = { office: "auditUi.officeInstructions", room: "auditUi.roomInstructions", agent: "auditUi.agentInstructions", member: "auditUi.memberInstructions" } as const;

export function AuditPane() {
  const { t, language } = useI18n();
  const [recordingId, setRecordingId] = useState<string | null>(null);
  const [page, setPage] = useState<AuditPage | null>(null);
  const [actor, setActor] = useState("");
  const [operation, setOperation] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<AuditFailure | null>(null);
  async function load(cursor?: string) {
    setBusy(true);
    try {
      const query = new URLSearchParams({ actor, operation, ...(cursor ? { cursor } : {}) });
      const data = await auditRequest(`/api/audit-log?${query}`);
      setPage((previous) => ({ entries: cursor ? [...(previous?.entries ?? []), ...data.entries] : data.entries, nextCursor: data.nextCursor }));
      setError(null);
    } catch (err) {
      setError(auditFailure(err, "auditUi.loadFailed"));
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    void load();
  }, []);
  return (
    <section style={{ padding: 16, overflowWrap: "anywhere" }}>
      <h2>{t("auditUi.title")}</h2>
      <RecordingsPane selectedId={recordingId} onClose={() => setRecordingId(null)} />
      <p>{t("auditUi.hint")}</p>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void load();
        }}
        style={{ display: "flex", flexWrap: "wrap", gap: 8 }}
      >
        <label style={{ maxWidth: "100%" }}>
          {t("auditUi.actor")} <input style={{ maxWidth: "100%" }} value={actor} onChange={(event) => setActor(event.target.value)} />
        </label>
        <label style={{ maxWidth: "100%" }}>
          {t("auditUi.operation")} <input style={{ maxWidth: "100%" }} value={operation} onChange={(event) => setOperation(event.target.value)} />
        </label>
        <button disabled={busy}>{t("auditUi.filter")}</button>
      </form>
      {error && <p role="alert">{auditFailureText(error, t)}</p>}
      {page?.entries.map((entry) => (
        <article key={entry.id} style={{ borderBottom: "1px solid var(--border-subtle)", padding: "12px 0", fontSize: 12 }}>
          <time>{new Date(entry.at).toLocaleString(language)}</time> · <strong>{entry.actor}</strong> · {t(OUTCOME_KEYS[entry.outcome])}
          <div>{entry.operation}</div>
          <div>{entry.target}</div>
          <div>{entry.fields.join(", ")}</div>
          {entry.recordingId && <button onClick={() => setRecordingId(entry.recordingId!)}>{t("auditUi.replayTerminal")}</button>}
          {entry.prompts?.map((prompt) => (
            <details key={`${prompt.scope}:${prompt.id}`} style={{ marginTop: 8 }}>
              <summary>
                {t(SCOPE_KEYS[prompt.scope])} · {prompt.id}
              </summary>
              <p>{t("auditUi.restoreHint")}</p>
              <pre style={{ whiteSpace: "pre-wrap", maxHeight: 320, overflow: "auto" }}>{prompt.text || t("auditUi.cleared")}</pre>
            </details>
          ))}
        </article>
      ))}
      {page && !page.entries.length && <p>{t("auditUi.empty")}</p>}
      {page?.nextCursor && (
        <button disabled={busy} onClick={() => void load(page.nextCursor!)}>
          {t("auditUi.older")}
        </button>
      )}
    </section>
  );
}
