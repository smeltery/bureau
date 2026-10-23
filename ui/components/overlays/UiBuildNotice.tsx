import { useEffect, useState } from "react";

export function UiBuildNotice() {
  const [current] = useState(() => document.querySelector('meta[name="bureau-ui-build"]')?.getAttribute("content") ?? null);
  const [latest, setLatest] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState<string | null>(null);
  useEffect(() => {
    if (!current || !/^[a-f0-9]{24}$/.test(current)) return;
    let stopped = false;
    let pending: AbortController | null = null;
    const check = async () => {
      if (document.hidden || pending || stopped) return;
      const abort = (pending = new AbortController());
      const timeout = setTimeout(() => abort.abort(), 10_000);
      try {
        const response = await fetch("/api/ui-build", { cache: "no-store", signal: abort.signal });
        if (!response.ok) return;
        const value = await response.json();
        if (!stopped && typeof value.build === "string" && /^[a-f0-9]{24}$/.test(value.build)) setLatest(value.build);
      } catch {
        // A disconnected tab checks again after reconnecting or becoming visible.
      } finally {
        clearTimeout(timeout);
        pending = null;
      }
    };
    void check();
    const refresh = () => void check();
    const timer = setInterval(refresh, 60_000);
    document.addEventListener("visibilitychange", refresh);
    window.addEventListener("online", refresh);
    window.addEventListener("focus", refresh);
    return () => {
      stopped = true;
      clearInterval(timer);
      pending?.abort();
      document.removeEventListener("visibilitychange", refresh);
      window.removeEventListener("online", refresh);
      window.removeEventListener("focus", refresh);
    };
  }, [current]);
  if (!latest || latest === current || latest === dismissed) return null;
  return (
    <div
      role="status"
      style={{
        position: "fixed",
        bottom: 12,
        left: "50%",
        transform: "translateX(-50%)",
        zIndex: 10000,
        maxWidth: "calc(100vw - 24px)",
        padding: "10px 14px",
        borderRadius: 8,
        background: "var(--bg-surface)",
        color: "var(--text-primary)",
        border: "1px solid var(--border)",
        display: "flex",
        flexWrap: "wrap",
        gap: 10,
        alignItems: "center",
      }}
    >
      <span>A new office interface is ready. Reload when you’re ready.</span>
      <button onClick={() => window.location.reload()}>Reload</button>
      <button onClick={() => setDismissed(latest)}>Later</button>
    </div>
  );
}
