import { useI18n } from "../../i18n.tsx";
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

class ApiError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
  }
}
type EnvFailure = string | { key: "integrations.variablesLoadFailed" | "integrations.variablesSaveFailed" } | { status: number };
function envFailure(error: unknown, key: "integrations.variablesLoadFailed" | "integrations.variablesSaveFailed"): EnvFailure {
  return error instanceof ApiError ? (error.status !== undefined ? { status: error.status } : error.message) : { key };
}

let nextEntryId = 1;

export function ManagedEnvEditor({ path, onSavedPath }: { path: string; onSavedPath?: (savedPath: string) => void }) {
  const { t } = useI18n();
  const [loaded, setLoaded] = useState<UserEnvRes | null>(null);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [saved, setSaved] = useState<Record<string, string>>({});
  const [error, setError] = useState<EnvFailure | null>(null);
  const errorText = error === null ? null : typeof error === "string" ? error : "status" in error ? t("common.requestFailed", { status: error.status }) : t(error.key);
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
      .catch((caught) => setError(envFailure(caught, "integrations.variablesLoadFailed")));
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
      setError(envFailure(caught, "integrations.variablesSaveFailed"));
    } finally {
      setSaving(false);
    }
  }

  if (!loaded) return <div style={dialogHint}>{errorText ?? t("integrations.variablesLoading")}</div>;

  return (
    <div>
      {entries.map((entry) => (
        <div key={entry.id} style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1.5fr) auto", gap: 8, marginBottom: 8 }}>
          <input
            aria-label={t("integrations.variableName")}
            value={entry.key}
            placeholder="VARIABLE_NAME"
            style={dialogInput}
            onChange={(event) => updateEntry(entry.id, { key: event.target.value })}
          />
          <input
            aria-label={t("integrations.variableValue", { name: entry.key || t("integrations.unnamedVariable") })}
            type={showValues ? "text" : "password"}
            autoComplete="off"
            value={entry.value}
            placeholder={t("integrations.value")}
            style={dialogInput}
            onChange={(event) => updateEntry(entry.id, { value: event.target.value })}
          />
          <button type="button" style={dialogCancelBtn} onClick={() => setEntries((all) => all.filter((item) => item.id !== entry.id))}>
            {t("common.remove")}
          </button>
        </div>
      ))}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
        <button type="button" style={dialogCancelBtn} onClick={() => setEntries((all) => [...all, { id: nextEntryId++, key: "", value: "" }])}>
          {t("integrations.addVariable")}
        </button>
        <button type="button" style={dialogCancelBtn} onClick={() => setShowValues((shown) => !shown)}>
          {showValues ? t("integrations.hideValues") : t("integrations.showValues")}
        </button>
        <button type="button" style={dialogSaveBtn} disabled={!dirty || duplicate || hasBlankKey || saving} onClick={() => void save()}>
          {saving ? t("common.saving") : dirty ? t("variables.save") : t("variables.saved")}
        </button>
      </div>
      <p style={{ ...dialogHint, margin: "8px 0 0" }}>{t("integrations.variablesPath", { path: loaded.path })}</p>
      {duplicate && <div style={{ color: "var(--red)", marginTop: 6, fontSize: 12 }}>{t("integrations.uniqueNames")}</div>}
      {error && <div style={{ color: "var(--red)", marginTop: 6, fontSize: 12 }}>{errorText}</div>}
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
    throw parsed?.error ? new ApiError(parsed.error) : new ApiError(`Request failed (${res.status})`, res.status);
  }
  return res.status === 204 ? (undefined as T) : ((await res.json()) as T);
}
