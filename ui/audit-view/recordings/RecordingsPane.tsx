import { useI18n } from "../../i18n.tsx";
import { auditRequest, auditFailure, auditFailureText, type AuditFailure } from "../api.ts";
import { useEffect, useRef, useState } from "react";
import type { RecordingHeader, RecordingView } from "../../../shared/terminal/recordings.ts";
import { RecordingReplay } from "./RecordingReplay.tsx";

const request = (path = "", init?: RequestInit) => auditRequest(`/api/terminal-recordings${path}`, init);
export function RecordingsPane({ selectedId, onClose }: { selectedId: string | null; onClose: () => void }) {
  const { t, language } = useI18n();
  const replayRequest = useRef(0);
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [recordings, setRecordings] = useState<(RecordingHeader & { active: boolean })[]>([]);
  const [view, setView] = useState<RecordingView | null>(null);
  const [error, setError] = useState<AuditFailure | null>(null);
  const [busy, setBusy] = useState(false);
  async function refresh() {
    try {
      const [settings, list] = await Promise.all([request("/settings"), request()]);
      setEnabled(settings.enabled);
      setRecordings(list.recordings);
      setError(null);
    } catch (error) {
      setError(auditFailure(error, "auditUi.recordingFailed"));
    }
  }
  async function open(id: string) {
    const requestId = ++replayRequest.current;
    setView(null);
    try {
      const recording = await request(`/${id}`);
      if (requestId !== replayRequest.current) return;
      setView(recording);
      setError(null);
    } catch (error) {
      if (requestId === replayRequest.current) setError(auditFailure(error, "auditUi.recordingFailed"));
    }
  }
  useEffect(() => {
    void refresh();
  }, []);
  useEffect(() => {
    if (selectedId) void open(selectedId);
  }, [selectedId]);
  async function toggle() {
    setBusy(true);
    try {
      const settings = await request("/settings", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ enabled: !enabled }) });
      setEnabled(settings.enabled);
      await refresh();
    } catch (error) {
      setError(auditFailure(error, "auditUi.recordingFailed"));
    } finally {
      setBusy(false);
    }
  }
  async function remove(id: string) {
    if (!confirm(t("auditUi.removeConfirm"))) return;
    setBusy(true);
    try {
      await request(`/${id}`, { method: "DELETE" });
      if (view?.header.id === id) setView(null);
      await refresh();
    } catch (error) {
      setError(auditFailure(error, "auditUi.recordingFailed"));
    } finally {
      setBusy(false);
    }
  }
  return (
    <section>
      <h3>{t("auditUi.recordings")}</h3>
      <label>
        <input type="checkbox" disabled={enabled === null || busy} checked={enabled ?? false} onChange={() => void toggle()} /> {t("auditUi.recordNew")}
      </label>
      <p>{t("auditUi.recordHint")}</p>
      {error && <p role="alert">{auditFailureText(error, t)}</p>}
      {view && (
        <RecordingReplay
          key={view.header.id}
          recording={view}
          onClose={() => {
            replayRequest.current++;
            setView(null);
            onClose();
          }}
        />
      )}
      <details>
        <summary>{t("auditUi.saved", { count: recordings.length.toLocaleString(language) })}</summary>
        <button onClick={() => void refresh()}>{t("auditUi.refreshRecordings")}</button>
        {recordings.map((item) => (
          <p key={item.id}>
            {new Date(item.startedAt).toLocaleString(language)} · {item.agentId}
            {item.active ? ` · ${t("auditUi.recording")}` : ""} <button onClick={() => void open(item.id)}>{t("auditUi.replay")}</button>{" "}
            <button disabled={busy || item.active} onClick={() => void remove(item.id)}>
              {t("common.remove")}
            </button>
          </p>
        ))}
      </details>
    </section>
  );
}
