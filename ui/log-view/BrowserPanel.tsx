import { useI18n } from "../i18n.tsx";
import type { PlainMessageKey } from "../../shared/i18n/translate.ts";
import { useCallback, useEffect, useState } from "react";
import { useBrowserLive } from "./hooks/useBrowserLive.ts";

type BrowserStatus = { enabled: boolean; active: boolean; url?: string };

/** Experimental agent browser: live CDP JPEG frames + manager drag-select/copy. */
export function BrowserPanel({ agentId, onClose }: { agentId: string; onClose: () => void }) {
  const { t } = useI18n();
  const [urlInput, setUrlInput] = useState("http://127.0.0.1:3000/");
  const [status, setStatus] = useState<BrowserStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | { key: PlainMessageKey } | { status: number }>("");
  const live = useBrowserLive(agentId);

  useEffect(() => {
    if (live.urlFromServer) setUrlInput(live.urlFromServer);
  }, [live.urlFromServer]);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch(`/api/agents/${agentId}/browser`, { credentials: "same-origin" });
      if (!res.ok) {
        setStatus(null);
        const payload = (await res.json().catch(() => ({}))) as { error?: unknown };
        setMessage(typeof payload.error === "string" ? payload.error : { status: res.status });
        return;
      }
      const body = (await res.json()) as BrowserStatus;
      setStatus(body);
      setMessage("");
      if (body.active && body.url) setUrlInput(body.url);
    } catch {
      setMessage({ key: "agentBrowser.requestFailed" });
    }
  }, [agentId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function run(body: Record<string, unknown>) {
    setBusy(true);
    setMessage("");
    live.clearCopyNote();
    live.clearLiveError();
    try {
      const res = await fetch(`/api/agents/${agentId}/browser`, {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const payload = (await res.json().catch(() => ({}))) as { error?: string; url?: string; title?: string };
      if (!res.ok) {
        setMessage(typeof payload.error === "string" ? payload.error : { status: res.status });
        return;
      }
      if (typeof payload.url === "string" && payload.url) setUrlInput(payload.url);
      setMessage(typeof payload.title === "string" && payload.title ? payload.title : { key: "agentBrowser.ok" });
      await refresh();
    } catch {
      setMessage({ key: "agentBrowser.requestFailed" });
    } finally {
      setBusy(false);
    }
  }

  const messageText = typeof message === "string" ? message : "status" in message ? t("agentBrowser.httpFailed", { status: message.status }) : t(message.key);
  const enabled = status?.enabled !== false;
  const statusLine =
    live.liveError || messageText || live.copyNote || (busy ? "…" : !enabled ? t("agentBrowser.disabled") : live.title || (live.available ? t("agentBrowser.live") : t("agentBrowser.empty")));

  return (
    <div
      style={{
        borderBottom: "1px solid var(--border-medium)",
        background: "var(--bg-elevated, var(--btn-surface))",
        padding: "10px 14px",
        display: "flex",
        flexDirection: "column",
        gap: 8,
        flexShrink: 0,
        minHeight: 280,
        maxHeight: "45vh",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
        <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text-primary)" }}>
          {t("agentBrowser.title")} <span style={{ fontWeight: 400, color: "var(--text-ghost)" }}>{t("agentBrowser.experimental")}</span>
        </div>
        <div style={{ display: "flex", gap: 6 }}>
          <button type="button" disabled={!live.available || busy || live.copying} onClick={() => void live.copySelection()} style={btnStyle}>
            {t("agentBrowser.copySelection")}
          </button>
          <button type="button" onClick={onClose} style={btnStyle}>
            {t("common.close")}
          </button>
        </div>
      </div>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        <input
          aria-label={t("agentBrowser.url")}
          value={urlInput}
          onChange={(e) => setUrlInput(e.target.value)}
          placeholder="http://127.0.0.1:3000/"
          disabled={busy || !enabled}
          style={{ flex: 1, minWidth: 160, fontSize: 12, padding: "6px 8px", borderRadius: 6, border: "1px solid var(--border-medium)", background: "var(--bg-base)", color: "var(--text-primary)" }}
        />
        <button type="button" disabled={busy || !enabled} onClick={() => void run({ action: "goto", url: urlInput.trim() })} style={btnStyle}>
          {t("common.open")}
        </button>
        <button type="button" disabled={busy || !enabled} onClick={() => void run({ action: "close" })} style={btnStyle}>
          {t("agentBrowser.end")}
        </button>
      </div>
      <div style={{ fontSize: 11, color: "var(--text-dim)", wordBreak: "break-word" }}>{statusLine}</div>
      <div ref={live.viewportRef} style={{ flex: 1, minHeight: 160, display: "grid", placeItems: "center", background: "var(--bg-code, var(--bg-base))", overflow: "hidden", borderRadius: 6 }}>
        <canvas
          ref={live.surfaceRef}
          role="application"
          aria-label={t("agentBrowser.surface")}
          tabIndex={0}
          onPointerMove={(e) => live.point(e, "mouseMoved")}
          onPointerDown={(e) => {
            if (e.button !== 0 || !live.coordinates(e)) return;
            e.preventDefault();
            e.currentTarget.focus();
            e.currentTarget.setPointerCapture(e.pointerId);
            live.point(e, "mousePressed");
          }}
          onPointerUp={(e) => {
            if (e.button !== 0) return;
            live.point(e, "mouseReleased");
            e.currentTarget.releasePointerCapture?.(e.pointerId);
          }}
          onPointerCancel={live.releaseHeld}
          onLostPointerCapture={live.releaseHeld}
          onWheel={live.onWheel}
          onKeyDown={live.onKeyDown}
          onKeyUp={live.onKeyUp}
          style={{ display: live.size ? "block" : "none", width: "100%", height: "100%", objectFit: "contain", touchAction: "none", outline: "none" }}
        />
        {!live.size && (
          <div style={{ color: "var(--text-ghost)", fontSize: 12, textAlign: "center" }}>
            {live.idleClosed ? (
              <>
                <div>{t("agentBrowser.idleClosed")}</div>
                <button type="button" disabled={busy || !enabled} onClick={() => void run({ action: "goto", url: urlInput.trim() })} style={{ ...btnStyle, marginTop: 8 }}>
                  {t("agentBrowser.reopen")}
                </button>
              </>
            ) : busy ? (
              t("common.loading")
            ) : (
              t("agentBrowser.waiting")
            )}
          </div>
        )}
      </div>
    </div>
  );
}

const btnStyle: React.CSSProperties = {
  padding: "6px 10px",
  borderRadius: 6,
  border: "1px solid var(--border-medium)",
  background: "var(--btn-surface)",
  color: "var(--text-dim)",
  fontSize: 11,
  cursor: "pointer",
};
