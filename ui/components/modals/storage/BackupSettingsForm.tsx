import { useEffect, useState } from "react";
import type { BackupSettingsSaved, BackupSettingsView } from "../../../../shared/storage-types.ts";
import { dialogCancelBtn, dialogInput } from "../dialog-styles.ts";
import { useI18n } from "../../../i18n.tsx";
import { storageRequest, storageFailure, type StorageFailure } from "./request.ts";

export function BackupSettingsForm({ onSaved }: { onSaved: () => void }) {
  const { t } = useI18n();
  const [view, setView] = useState<BackupSettingsView | null>(null);
  const [interval, setIntervalHours] = useState("24");
  const [retention, setRetention] = useState("7");
  const [directory, setDirectory] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<StorageFailure | null>(null);
  const [notice, setNotice] = useState<{ previousDir: string | null } | null>(null);

  function apply(value: BackupSettingsView) {
    setView(value);
    setIntervalHours(String(value.settings.intervalHours));
    setRetention(String(value.settings.retention));
    setDirectory(value.directoryFromEnvironment ? value.effectiveDir : (value.settings.dir ?? ""));
  }
  useEffect(() => {
    let active = true;
    storageRequest<BackupSettingsView>("/api/backup/settings", "storage.backup.loadFailed")
      .then((value) => {
        if (active) apply(value);
      })
      .catch((error) => {
        if (active) setError(storageFailure(error, "storage.backup.loadFailed"));
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
      const saved = await storageRequest<BackupSettingsSaved>("/api/backup/settings", "storage.backup.saveFailed", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          intervalHours: Number(interval),
          retention: Number(retention),
          ...(view.directoryFromEnvironment ? {} : { dir: directory || null }),
        }),
      });
      apply(saved);
      setNotice({ previousDir: saved.previousDir });
      onSaved();
    } catch (error) {
      setError(storageFailure(error, "storage.backup.saveFailed"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div style={{ marginTop: 12, display: "grid", gap: 8, fontSize: 12 }}>
      {error && (
        <p role="alert" style={{ margin: 0, color: "var(--red)" }}>
          {typeof error === "string" ? error : t(error.key)}
        </p>
      )}
      {view && (
        <>
          <label>
            {t("storage.backup.interval")}
            <input type="number" min={1} max={720} step={1} value={interval} onChange={(event) => setIntervalHours(event.target.value)} disabled={saving} style={dialogInput} />
          </label>
          <label>
            {t("storage.backup.retention")}
            <input type="number" min={1} max={100} step={1} value={retention} onChange={(event) => setRetention(event.target.value)} disabled={saving} style={dialogInput} />
          </label>
          <label>
            {t("storage.backup.directory")}
            <input value={directory} onChange={(event) => setDirectory(event.target.value)} disabled={saving || view.directoryFromEnvironment} placeholder={view.effectiveDir} style={dialogInput} />
          </label>
          <span style={{ color: "var(--text-muted)" }}>{view.directoryFromEnvironment ? t("storage.backup.environment") : t("storage.backup.directoryHint")}</span>
          <span style={{ color: "var(--text-muted)" }}>{t("storage.backup.runningHint")}</span>
          <button type="button" onClick={() => void save()} disabled={saving} style={{ ...dialogCancelBtn, justifySelf: "start" }}>
            {saving ? t("common.saving") : t("storage.backup.save")}
          </button>
        </>
      )}
      {notice && (
        <p role="status" style={{ margin: 0 }}>
          {notice.previousDir ? t("storage.backup.previousDir", { path: notice.previousDir }) : t("storage.backup.saved")}
        </p>
      )}
    </div>
  );
}
