import { useState } from "react";
import type { AppListWire } from "../../shared/apps.ts";
import { useDispatch } from "../store.tsx";

export function AppArtwork({ app }: { app: AppListWire }) {
  const dispatch = useDispatch();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const path = `/api/apps/${encodeURIComponent(app.name)}/thumbnail`;
  async function save(file: File | null) {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(path, { method: file ? "PUT" : "DELETE", ...(file ? { body: file, headers: { "Content-Type": "image/png" } } : {}) });
      const result = await response.json();
      if (!response.ok) throw new Error(result?.error?.message ?? "Could not save thumbnail");
      dispatch({ type: "app_updated", app: result });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save thumbnail");
    } finally {
      setBusy(false);
    }
  }
  return (
    <div>
      {app.thumbnailVersion && (
        <img src={`${path}?v=${app.thumbnailVersion}`} alt={`${app.name} thumbnail`} style={{ width: "100%", maxHeight: 220, objectFit: "cover", borderRadius: 6, marginTop: 8 }} />
      )}
      {app.canManage && (
        <div style={{ marginTop: 8 }}>
          <label>
            Thumbnail{" "}
            <input
              aria-label={`Upload thumbnail for ${app.name}`}
              type="file"
              accept="image/png"
              disabled={busy}
              onChange={(event) => {
                const file = event.target.files?.[0];
                event.target.value = "";
                if (!file) return;
                if (file.size > 1024 * 1024) {
                  setError("Choose a PNG up to 1 MiB.");
                  return;
                }
                void save(file);
              }}
            />
          </label>
          {app.thumbnailVersion && (
            <button disabled={busy} onClick={() => void save(null)}>
              Remove thumbnail
            </button>
          )}
        </div>
      )}
      {error && <p role="alert">{error}</p>}
    </div>
  );
}
