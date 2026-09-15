import { useCallback, useEffect, useState } from "react";

type BrowserStatus = { enabled: boolean; active: boolean; url?: string };

/** MVP status/drive strip for experimental.browserPanel. Live frames deferred. */
export function BrowserPanel({ agentId, onClose }: { agentId: string; onClose: () => void }) {
  const [urlInput, setUrlInput] = useState("http://127.0.0.1:3000/");
  const [status, setStatus] = useState<BrowserStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

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
      }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
        <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text-primary)" }}>
          Agent browser <span style={{ fontWeight: 400, color: "var(--text-ghost)" }}>(experimental)</span>
        </div>
        <button type="button" onClick={onClose} style={btnStyle}>
          Close
        </button>
      </div>
      <div style={{ fontSize: 11, color: "var(--text-muted)" }}>
        {status == null ? "…" : status.enabled ? (status.active ? `Open: ${status.url}` : "No page open — agents (or you) can goto a local/allowlisted URL.") : "Disabled in Office Settings."}
      </div>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        <input
          value={urlInput}
          onChange={(e) => setUrlInput(e.target.value)}
          placeholder="http://127.0.0.1:3000/"
          disabled={busy || status?.enabled === false}
          style={{ flex: 1, minWidth: 160, fontSize: 12, padding: "6px 8px", borderRadius: 6, border: "1px solid var(--border-medium)", background: "var(--bg-base)", color: "var(--text-primary)" }}
        />
        <button type="button" disabled={busy || !status?.enabled} onClick={() => void run({ action: "goto", url: urlInput.trim() })} style={btnStyle}>
          Open
        </button>
        <button type="button" disabled={busy || !status?.enabled} onClick={() => void run({ action: "snapshot" })} style={btnStyle}>
          Snapshot
        </button>
        <button type="button" disabled={busy || !status?.enabled} onClick={() => void run({ action: "screenshot" })} style={btnStyle}>
          Screenshot
        </button>
        <button type="button" disabled={busy || !status?.enabled} onClick={() => void run({ action: "close" })} style={btnStyle}>
          End
        </button>
      </div>
      {message ? <div style={{ fontSize: 11, color: "var(--text-dim)", wordBreak: "break-word" }}>{message}</div> : null}
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
