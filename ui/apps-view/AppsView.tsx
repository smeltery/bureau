// The Apps tab — agent-built web apps bureau runs and keeps running. Beside
// Cron jobs, which is the precedent for "a thing bureau runs that is not an
// agent" (docs/features/agent-apps.md).
//
// A VIEWER PLUS VERBS: no register form and no edit form here. Agents register
// apps through the API, and this tab is where a human watches them and takes
// them in hand — start, stop, restart, read the log, delete one.

import { AppCard } from "./AppCard.tsx";
import { AppDeleteDialog } from "./AppDeleteDialog.tsx";
import { useAppsViewController } from "./useAppsViewController.ts";
import { useFeatures } from "../store.tsx";
import { useI18n } from "../i18n.tsx";

export function AppsView({ onClose }: { onClose: () => void }) {
  const { act, appsLoaded, busy, confirmDelete, doDelete, error, isMobile, logError, logLines, openLogs, previewsEnabled, setConfirmDelete, setPreviewsEnabled, sorted, toggleLogs } =
    useAppsViewController();
  const features = useFeatures();
  const { t } = useI18n();

  return (
    <div style={{ height: isMobile ? "100dvh" : "100vh", display: "flex", flexDirection: "column", background: "var(--bg-base)", color: "var(--text-primary)" }}>
      {/* Header. minHeight (not height) so the safe-area padding extends the bar
          below the notch instead of squashing its contents. */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: isMobile ? "0 12px" : "0 20px",
          paddingTop: isMobile ? "env(safe-area-inset-top, 0px)" : undefined,
          minHeight: 44,
          background: "var(--bg-hud)",
          backdropFilter: "blur(16px)",
          borderBottom: "1px solid var(--border-subtle)",
          flexShrink: 0,
          zIndex: 500,
        }}
      >
        <button onClick={onClose} aria-label={t("common.back")} style={{ background: "none", border: "none", color: "var(--text-muted)", fontSize: 18, cursor: "pointer", padding: "2px 8px" }}>
          ←
        </button>
        <div style={{ fontSize: 13, fontWeight: 600 }}>{t("apps.title")}</div>
        <button
          type="button"
          onClick={() => setPreviewsEnabled(!previewsEnabled)}
          title={previewsEnabled ? t("apps.hidePreviews") : t("apps.showPreviews")}
          style={{
            marginLeft: "auto",
            padding: "3px 7px",
            border: "1px solid var(--border)",
            borderRadius: 6,
            background: previewsEnabled ? "var(--accent)" : "transparent",
            color: previewsEnabled ? "var(--bg-base)" : "var(--text-muted)",
            fontSize: 11,
            cursor: "pointer",
          }}
        >
          {previewsEnabled ? t("apps.previewsOn") : t("apps.previewsOff")}
        </button>
        <div style={{ fontSize: 11, color: "var(--text-muted)" }}>{appsLoaded ? `${sorted.length}` : ""}</div>
      </div>

      {error && <div style={{ padding: "8px 16px", background: "var(--bg-subtle)", borderBottom: "1px solid var(--border-subtle)", color: "var(--red)", fontSize: 12, flexShrink: 0 }}>{error}</div>}

      <div style={{ flex: 1, overflowY: "auto", padding: isMobile ? 12 : 20 }}>
        {!appsLoaded ? null : sorted.length === 0 ? (
          <div style={{ color: "var(--text-muted)", fontSize: 13, padding: "24px 4px" }}>{t("apps.empty")}</div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {sorted.map((app) => (
              <AppCard
                key={app.name}
                app={app}
                isBusy={busy?.startsWith(`${app.name}:`) ?? false}
                isMobile={isMobile}
                logOpen={openLogs === app.name}
                logLines={logLines}
                logError={logError}
                previewsEnabled={previewsEnabled}
                livePreviewFramesAllowed={features.liveAppPreviews}
                onAct={(verb) => void act(app.name, verb)}
                onToggleLogs={() => void toggleLogs(app.name)}
                onDelete={() => setConfirmDelete(app)}
              />
            ))}
          </div>
        )}
      </div>

      {confirmDelete && <AppDeleteDialog name={confirmDelete.name} busy={busy !== null} onCancel={() => setConfirmDelete(null)} onConfirm={() => void doDelete(confirmDelete)} />}
    </div>
  );
}
