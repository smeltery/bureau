import { useCallback, useEffect, useState } from "react";
import { useBrowserLive } from "./hooks/useBrowserLive.ts";

type BrowserStatus = { enabled: boolean; active: boolean; url?: string };

/** Experimental agent browser: live CDP JPEG frames + manager drag-select/copy. */
export function BrowserPanel({ agentId, onClose }: { agentId: string; onClose: () => void }) {
  const [urlInput, setUrlInput] = useState("http://127.0.0.1:3000/");
  const [status, setStatus] = useState<BrowserStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const live = useBrowserLive(agentId);

  useEffect(() => {
    if (live.urlFromServer) setUrlInput(live.urlFromServer);
  }, [live.urlFromServer]);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch(`/api/agents/${agentId}/browser`, { credentials: "same-origin" });
      if (!res.ok) {
        setStatus(null);
        setMessage(((await res.json().catch(() => ({}))) as { error?: string }).error ?? `status ${res.status}`);
        return;
      }
      const body = (await res.json()) as BrowserStatus;
      setStatus(body);
      setMessage("");
      if (body.active && body.url) setUrlInput(body.url);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : String(err));
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
        setMessage(typeof payload.error === "string" ? payload.error : `error ${res.status}`);
        return;
      }
      if (typeof payload.url === "string" && payload.url) setUrlInput(payload.url);
      setMessage(typeof payload.title === "string" && payload.title ? payload.title : "ok");
      await refresh();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  const enabled = status?.enabled !== false;
  const statusLine =
    live.liveError || message || live.copyNote || (busy ? "…" : !enabled ? "Disabled in Office Settings." : live.title || (live.available ? "Live" : "No page open — local/allowlisted URLs only."));

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
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
        <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text-primary)" }}>
          Agent browser <span style={{ fontWeight: 400, color: "var(--text-ghost)" }}>(experimental)</span>
        </div>
        <div style={{ display: "flex", gap: 6 }}>
          <button type="button" disabled={!live.available || busy || live.copying} onClick={() => void live.copySelection()} style={btnStyle}>
            Copy selection
          </button>
          <button type="button" onClick={onClose} style={btnStyle}>
            Close
          </button>
        </div>
      </div>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        <input
          value={urlInput}
          onChange={(e) => setUrlInput(e.target.value)}
          placeholder="http://127.0.0.1:3000/"
          disabled={busy || !enabled}
          style={{ flex: 1, minWidth: 160, fontSize: 12, padding: "6px 8px", borderRadius: 6, border: "1px solid var(--border-medium)", background: "var(--bg-base)", color: "var(--text-primary)" }}
        />
        <button type="button" disabled={busy || !enabled} onClick={() => void run({ action: "goto", url: urlInput.trim() })} style={btnStyle}>
          Open
        </button>
        <button type="button" disabled={busy || !enabled} onClick={() => void run({ action: "close" })} style={btnStyle}>
          End
        </button>
      </div>
      <div style={{ fontSize: 11, color: "var(--text-dim)", wordBreak: "break-word" }}>{statusLine}</div>
      <div ref={live.viewportRef} style={{ flex: 1, minHeight: 160, display: "grid", placeItems: "center", background: "var(--bg-code, var(--bg-base))", overflow: "hidden", borderRadius: 6 }}>
        <canvas
          ref={live.surfaceRef}
          role="application"
          aria-label="Agent browser surface"
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
          style={{ display: live.size ? "block" : "none", width: "100%", height: "100%", objectFit: "contain", touchAction: "none", outline: "none" }}
        />
        {!live.size && <div style={{ color: "var(--text-ghost)", fontSize: 12 }}>{busy ? "Loading…" : "Waiting for live frame…"}</div>}
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
