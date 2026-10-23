import { useEffect, useRef, useState } from "react";
import type { RecordingHeader, RecordingView } from "../../../shared/terminal/recordings.ts";
import { RecordingReplay } from "./RecordingReplay.tsx";

async function request(path = "", init?: RequestInit) {
  const response = await fetch(`/api/terminal-recordings${path}`, init);
  const result = await response.json();
  if (!response.ok) throw new Error(result.error ?? "Unable to load recordings");
  return result;
}
export function RecordingsPane({ selectedId, onClose }: { selectedId: string | null; onClose: () => void }) {
  const replayRequest = useRef(0);
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [recordings, setRecordings] = useState<(RecordingHeader & { active: boolean })[]>([]);
  const [view, setView] = useState<RecordingView | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function refresh() {
    try {
      const [settings, list] = await Promise.all([request("/settings"), request()]);
      setEnabled(settings.enabled);
      setRecordings(list.recordings);
      setError("");
    } catch (error) {
      setError(String(error));
    }
  }
  async function open(id: string) {
    const requestId = ++replayRequest.current;
    setView(null);
    try {
      const recording = await request(`/${id}`);
      if (requestId !== replayRequest.current) return;
      setView(recording);
      setError("");
    } catch (error) {
      setError(String(error));
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
      setError(String(error));
    } finally {
      setBusy(false);
    }
  }
  async function remove(id: string) {
    if (!confirm("Permanently remove this terminal recording?")) return;
    setBusy(true);
    try {
      await request(`/${id}`, { method: "DELETE" });
      if (view?.header.id === id) setView(null);
      await refresh();
    } catch (error) {
      setError(String(error));
    } finally {
      setBusy(false);
    }
  }
  return (
    <section>
      <h3>Terminal recordings</h3>
      <label>
        <input type="checkbox" disabled={enabled === null || busy} checked={enabled ?? false} onChange={() => void toggle()} /> Record newly opened terminals
      </label>
      <p>
        Off by default. Records displayed output, dimensions and who typed, never input text. Output may contain secrets despite best-effort masking. Turning this off stops current recordings. Restart
        an existing terminal to begin recording after enabling.
      </p>
      {error && <p role="alert">{error}</p>}
      {view && (
        <RecordingReplay
          key={view.header.id}
          recording={view}
          onClose={() => {
            setView(null);
            onClose();
          }}
        />
      )}
      <details>
        <summary>Saved recordings ({recordings.length})</summary>
        <button onClick={() => void refresh()}>Refresh recordings</button>
        {recordings.map((item) => (
          <p key={item.id}>
            {new Date(item.startedAt).toLocaleString()} · {item.agentId}
            {item.active ? " · Recording" : ""} <button onClick={() => void open(item.id)}>Replay</button>{" "}
            <button disabled={busy || item.active} onClick={() => void remove(item.id)}>
              Remove
            </button>
          </p>
        ))}
      </details>
    </section>
  );
}
