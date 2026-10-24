import { useI18n } from "../i18n.tsx";
import { appResponseError, appFailure, appFailureText, type AppFailure } from "./appsApi.ts";
import { useState } from "react";
import type { AppListWire } from "../../shared/apps.ts";
import { useDispatch } from "../store.tsx";

export function AppArtwork({ app }: { app: AppListWire }) {
  const { t } = useI18n();
  const dispatch = useDispatch();
  const [error, setError] = useState<AppFailure | null>(null);
  const [busy, setBusy] = useState(false);
  const path = `/api/apps/${encodeURIComponent(app.name)}/thumbnail`;
  async function save(file: File | null) {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(path, { method: file ? "PUT" : "DELETE", ...(file ? { body: file, headers: { "Content-Type": "image/png" } } : {}) });
      const result = await response.json();
      if (!response.ok) throw appResponseError(result, response.status);
      dispatch({ type: "app_updated", app: result });
    } catch (err) {
      setError(appFailure(err, "appsUi.thumbnailFailed"));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div>
      {app.thumbnailVersion && (
        <img
          src={`${path}?v=${app.thumbnailVersion}`}
          alt={t("appsUi.thumbnailAlt", { name: app.name })}
          style={{ width: "100%", maxHeight: 220, objectFit: "cover", borderRadius: 6, marginTop: 8 }}
        />
      )}
      {app.canManage && (
        <div style={{ marginTop: 8 }}>
          <label>
            {t("appsUi.thumbnail")}{" "}
            <input
              aria-label={t("appsUi.thumbnailUpload", { name: app.name })}
              style={{ maxWidth: "100%" }}
              type="file"
              accept="image/png"
              disabled={busy}
              onChange={(event) => {
                const file = event.target.files?.[0];
                event.target.value = "";
                if (!file) return;
                if (file.size > 1024 * 1024) {
                  setError({ key: "appsUi.thumbnailLimit" });
                  return;
                }
                void save(file);
              }}
            />
          </label>
          {app.thumbnailVersion && (
            <button disabled={busy} onClick={() => void save(null)}>
              {t("appsUi.thumbnailRemove")}
            </button>
          )}
        </div>
      )}
      {error && <p role="alert">{appFailureText(error, t)}</p>}
    </div>
  );
}
