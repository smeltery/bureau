import { useEffect, useState } from "react";
import type { BackupSettingsSaved, BackupSettingsView } from "../../../../shared/storage-types.ts";
import { dialogCancelBtn, dialogInput } from "../dialog-styles.ts";

async function request(method: "GET" | "PATCH", body?: unknown): Promise<BackupSettingsView | BackupSettingsSaved> {
  const response = await fetch("/api/backup/settings", {
    method,
    credentials: "same-origin",
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error ?? "Could not update backup settings.");
  return result;
}

export function BackupSettingsForm({ onSaved }: { onSaved: () => void }) {
  const [view, setView] = useState<BackupSettingsView | null>(null);
  const [interval, setIntervalHours] = useState("24");
  const [retention, setRetention] = useState("7");
  const [directory, setDirectory] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  function apply(value: BackupSettingsView) {
    setView(value);
    setIntervalHours(String(value.settings.intervalHours));
    setRetention(String(value.settings.retention));
    setDirectory(value.directoryFromEnvironment ? value.effectiveDir : (value.settings.dir ?? ""));
  }
  useEffect(() => {
    let active = true;
    request("GET")
      .then((value) => {
        if (active) apply(value);
      })
      .catch((error) => {
        if (active) setError(error.message);
      });
    return () => {
      active = false;
    };
  }, []);

  async function save() {
    if (!view || saving) return;
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const saved = (await request("PATCH", {
        intervalHours: Number(interval),
        retention: Number(retention),
        ...(view.directoryFromEnvironment ? {} : { dir: directory || null }),
      })) as BackupSettingsSaved;
      apply(saved);
      setNotice(saved.previousDir ? `Saved. Existing backups remain in ${saved.previousDir}; they were not moved or deleted.` : "Saved. Changes apply at the next hourly backup check.");
      onSaved();
    } catch (error) {
      setError(error instanceof Error ? error.message : "Could not update backup settings.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div style={{ marginTop: 12, display: "grid", gap: 8, fontSize: 12 }}>
      {error && (
        <p role="alert" style={{ margin: 0, color: "var(--red)" }}>
          {error}
        </p>
      )}
      {view && (
        <>
          <label>
            Backup interval (hours, 1–720)
            <input type="number" min={1} max={720} step={1} value={interval} onChange={(event) => setIntervalHours(event.target.value)} disabled={saving} style={dialogInput} />
          </label>
          <label>
            Backups to keep (1–100)
            <input type="number" min={1} max={100} step={1} value={retention} onChange={(event) => setRetention(event.target.value)} disabled={saving} style={dialogInput} />
          </label>
          <label>
            Backup directory
            <input value={directory} onChange={(event) => setDirectory(event.target.value)} disabled={saving || view.directoryFromEnvironment} placeholder={view.effectiveDir} style={dialogInput} />
          </label>
          <span style={{ color: "var(--text-muted)" }}>
            {view.directoryFromEnvironment ? "BUREAU_BACKUP_DIR controls this directory." : "Use an absolute path outside the office state directory. Leave empty to use the default."}
          </span>
          <span style={{ color: "var(--text-muted)" }}>An in-progress backup keeps its original settings. Retention applies after a new backup is verified.</span>
          <button type="button" onClick={() => void save()} disabled={saving} style={{ ...dialogCancelBtn, justifySelf: "start" }}>
            {saving ? "Saving…" : "Save backup settings"}
          </button>
        </>
      )}
      {notice && (
        <p role="status" style={{ margin: 0 }}>
          {notice}
        </p>
      )}
    </div>
  );
}
