import { RecordingsPane } from "./recordings/RecordingsPane.tsx";
import { useEffect, useState } from "react";
import type { AuditPage } from "../../shared/integrations/audit.ts";

export function AuditPane() {
  const [recordingId, setRecordingId] = useState<string | null>(null);
  const [page, setPage] = useState<AuditPage | null>(null);
  const [actor, setActor] = useState("");
  const [operation, setOperation] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function load(cursor?: string) {
    setBusy(true);
    try {
      const query = new URLSearchParams({ actor, operation, ...(cursor ? { cursor } : {}) });
      const response = await fetch(`/api/audit-log?${query}`);
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Unable to read audit log");
      setPage((previous) => ({ entries: cursor ? [...(previous?.entries ?? []), ...data.entries] : data.entries, nextCursor: data.nextCursor }));
      setError(null);
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    void load();
  }, []);
  return (
    <section style={{ padding: 16, overflowWrap: "anywhere" }}>
      <h2>Audit log</h2>
      <RecordingsPane selectedId={recordingId} onClose={() => setRecordingId(null)} />
      <p>Persisted office changes, with their actor and outcome. Pending means a write was interrupted or its final audit status could not be saved.</p>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void load();
        }}
        style={{ display: "flex", flexWrap: "wrap", gap: 8 }}
      >
        <label>
          Actor <input value={actor} onChange={(event) => setActor(event.target.value)} />
        </label>
        <label>
          Operation <input value={operation} onChange={(event) => setOperation(event.target.value)} />
        </label>
        <button disabled={busy}>Filter / refresh</button>
      </form>
      {error && <p role="alert">{error}</p>}
      {page?.entries.map((entry) => (
        <article key={entry.id} style={{ borderBottom: "1px solid var(--border-subtle)", padding: "12px 0", fontSize: 12 }}>
          <time>{new Date(entry.at).toLocaleString()}</time> · <strong>{entry.actor}</strong> · {entry.outcome}
          <div>{entry.operation}</div>
          <div>{entry.target}</div>
          <div>{entry.fields.join(", ")}</div>
          {entry.recordingId && <button onClick={() => setRecordingId(entry.recordingId!)}>Replay terminal</button>}
          {entry.prompts?.map((prompt) => (
            <details key={`${prompt.scope}:${prompt.id}`} style={{ marginTop: 8 }}>
              <summary>
                {prompt.scope} instructions · {prompt.id}
              </summary>
              <p>Saved text after this change. To restore it, copy it into the corresponding settings editor and save against the current version.</p>
              <pre style={{ whiteSpace: "pre-wrap", maxHeight: 320, overflow: "auto" }}>{prompt.text || "(Instructions cleared)"}</pre>
            </details>
          ))}
        </article>
      ))}
      {page && !page.entries.length && <p>No matching changes.</p>}
      {page?.nextCursor && (
        <button disabled={busy} onClick={() => void load(page.nextCursor!)}>
          Older changes
        </button>
      )}
    </section>
  );
}
