import { useEffect, useMemo, useState } from "react";
import { dialogCancelBtn, dialogHint, dialogInput, dialogSaveBtn } from "./dialog-styles.ts";

interface UserEnvRes {
  mode: "managed";
  path: string;
  values: Record<string, string>;
}

interface Entry {
  id: number;
  key: string;
  value: string;
}

class ApiError extends Error {}

let nextEntryId = 1;

export function ManagedEnvEditor({ path, onSavedPath }: { path: string; onSavedPath?: (savedPath: string) => void }) {
  const [loaded, setLoaded] = useState<UserEnvRes | null>(null);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [saved, setSaved] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [showValues, setShowValues] = useState(false);

  useEffect(() => {
    void apiFetch<UserEnvRes>("GET", path)
      .then((result) => {
        setLoaded(result);
        setEntries(entriesOf(result.values));
        setSaved(result.values);
        setError(null);
      })
      .catch((caught) => setError(caught instanceof ApiError ? caught.message : "Could not load variables"));
  }, [path]);

  const current = useMemo(() => Object.fromEntries(entries.map((entry) => [entry.key, entry.value])), [entries]);
  const duplicate = entries.some((entry, index) => entry.key && entries.findIndex((other) => other.key === entry.key) !== index);
  const hasBlankKey = entries.some((entry) => !entry.key);
  const dirty = JSON.stringify(current) !== JSON.stringify(saved);

  async function save() {
    if (duplicate || hasBlankKey) return;
    setSaving(true);
    setError(null);
    try {
      const savedPath = loaded?.path;
      await apiFetch("PUT", path, { values: current });
      setSaved(current);
      if (savedPath) onSavedPath?.(savedPath);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "Could not save variables");
    } finally {
      setSaving(false);
    }
  }

  if (!loaded) return <div style={dialogHint}>{error ?? "Loading variables..."}</div>;

  return (
    <div>
      {entries.map((entry) => (
        <div key={entry.id} style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1.5fr) auto", gap: 8, marginBottom: 8 }}>
          <input aria-label="Variable name" value={entry.key} placeholder="VARIABLE_NAME" style={dialogInput} onChange={(event) => updateEntry(entry.id, { key: event.target.value })} />
          <input
            aria-label={`${entry.key || "Variable"} value`}
            type={showValues ? "text" : "password"}
            autoComplete="off"
            value={entry.value}
            placeholder="Value"
            style={dialogInput}
            onChange={(event) => updateEntry(entry.id, { value: event.target.value })}
          />
          <button type="button" style={dialogCancelBtn} onClick={() => setEntries((all) => all.filter((item) => item.id !== entry.id))}>
            Remove
          </button>
        </div>
      ))}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
        <button type="button" style={dialogCancelBtn} onClick={() => setEntries((all) => [...all, { id: nextEntryId++, key: "", value: "" }])}>
          Add variable
        </button>
        <button type="button" style={dialogCancelBtn} onClick={() => setShowValues((shown) => !shown)}>
          {showValues ? "Hide values" : "Show values"}
        </button>
        <button type="button" style={dialogSaveBtn} disabled={!dirty || duplicate || hasBlankKey || saving} onClick={() => void save()}>
          {saving ? "Saving..." : dirty ? "Save variables" : "Variables saved"}
        </button>
      </div>
      <p style={{ ...dialogHint, margin: "8px 0 0" }}>Saved at {loaded.path}. Values stay masked until revealed.</p>
      {duplicate && <div style={{ color: "var(--red)", marginTop: 6, fontSize: 12 }}>Variable names must be unique.</div>}
      {error && <div style={{ color: "var(--red)", marginTop: 6, fontSize: 12 }}>{error}</div>}
    </div>
  );

  function updateEntry(id: number, change: Partial<Entry>) {
    setEntries((all) => all.map((item) => (item.id === id ? { ...item, ...change } : item)));
  }
}

function entriesOf(values: Record<string, string>): Entry[] {
  return Object.entries(values)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => ({ id: nextEntryId++, key, value }));
}

async function apiFetch<T = unknown>(method: "GET" | "PUT", path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const parsed = await res.json().catch(() => null);
    throw new ApiError(parsed?.error || `Request failed (${res.status})`);
  }
  return res.status === 204 ? (undefined as T) : ((await res.json()) as T);
}
