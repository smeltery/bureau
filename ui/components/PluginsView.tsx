import { useEffect, useState } from "react";
import { useAppState, useDispatch } from "../store.tsx";
import type { CCPluginsState } from "../../shared/types.ts";
import { DiscoverList } from "./PluginsDiscoverList.tsx";
import { InstalledTable } from "./PluginsInstalledTable.tsx";
import { MarketplacesTable } from "./PluginsMarketplacesTable.tsx";
import { useI18n } from "../i18n.tsx";
import type { PlainMessageKey } from "../../shared/i18n/translate.ts";

// Claude Code plugin manager — Installed / Discover / Marketplaces. Mutations
// go through the HTTP API (server shells out to the headless `claude plugin`
// CLI); the server broadcasts the refreshed catalog to every browser, and the
// POST response carries the same snapshot so this tab updates immediately.

type Tab = "installed" | "discover" | "marketplaces";
const TAB_LABEL_KEYS: Record<Tab, PlainMessageKey> = {
  installed: "plugins.tab.installed",
  discover: "plugins.tab.discover",
  marketplaces: "plugins.tab.marketplaces",
};

async function fetchState(refresh: boolean): Promise<CCPluginsState> {
  const res = await fetch(`/plugins${refresh ? "?refresh=1" : ""}`);
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

async function postPlugins(path: string, body: Record<string, unknown>): Promise<CCPluginsState> {
  const res = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

export function PluginsView({ onClose }: { onClose: () => void }) {
  const { ccPlugins, isMobile } = useAppState();
  const dispatch = useDispatch();
  const { t } = useI18n();
  const [tab, setTab] = useState<Tab>("installed");
  const [busy, setBusy] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [loadFailed, setLoadFailed] = useState<string | null>(null);

  // First open fetches the catalog; afterwards the store stays warm via
  // server broadcasts, so reopening the panel is instant.
  useEffect(() => {
    if (ccPlugins) return;
    fetchState(false)
      .then((plugins) => dispatch({ type: "cc_plugins_state", plugins }))
      .catch((err) => setLoadFailed(err instanceof Error ? err.message : String(err)));
  }, [ccPlugins, dispatch]);

  function runAction(key: string, fn: () => Promise<CCPluginsState>, doneNotice?: string) {
    setError(null);
    setNotice(null);
    setBusy((prev) => new Set(prev).add(key));
    fn()
      .then((plugins) => {
        dispatch({ type: "cc_plugins_state", plugins });
        if (doneNotice) setNotice(doneNotice);
      })
      .catch((err) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => {
        setBusy((prev) => {
          const next = new Set(prev);
          next.delete(key);
          return next;
        });
      });
  }

  const refreshing = busy.has("refresh");

  return (
    <div
      style={{
        height: isMobile ? "100dvh" : "100vh",
        display: "flex",
        flexDirection: "column",
        background: "var(--bg-base)",
        color: "var(--text-primary)",
      }}
    >
      {/* Header — mirrors CronjobsView: back arrow, tab pills, actions right */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
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
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <button onClick={onClose} style={{ background: "none", border: "none", color: "var(--text-muted)", fontSize: 18, cursor: "pointer", padding: "2px 8px" }}>
            ←
          </button>
          <div style={{ display: "flex", border: "1px solid var(--border)", borderRadius: 6, overflow: "hidden" }}>
            {(["installed", "discover", "marketplaces"] as Tab[]).map((tabKey) => (
              <button
                key={tabKey}
                onClick={() => setTab(tabKey)}
                style={{
                  padding: "5px 12px",
                  border: "none",
                  background: tab === tabKey ? "var(--accent)" : "transparent",
                  color: tab === tabKey ? "var(--bg-base)" : "var(--text-muted)",
                  fontSize: 11,
                  fontWeight: 600,
                  cursor: "pointer",
                  textTransform: "capitalize",
                }}
              >
                {t(TAB_LABEL_KEYS[tabKey])}
              </button>
            ))}
          </div>
        </div>
        <button
          onClick={() => runAction("refresh", () => fetchState(true))}
          disabled={refreshing}
          style={{
            padding: "4px 10px",
            borderRadius: 6,
            border: "1px solid var(--border)",
            background: "transparent",
            color: "var(--text-dim)",
            fontSize: 11,
            cursor: refreshing ? "default" : "pointer",
            opacity: refreshing ? 0.6 : 1,
          }}
        >
          {refreshing ? t("plugins.refreshing") : t("plugins.refresh")}
        </button>
      </div>

      {/* Action feedback */}
      {error && (
        <Banner color="var(--red)" onDismiss={() => setError(null)}>
          {error}
        </Banner>
      )}
      {notice && (
        <Banner color="var(--accent)" onDismiss={() => setNotice(null)}>
          {notice}
        </Banner>
      )}

      {/* Body */}
      <div style={{ flex: 1, overflow: "auto" }}>
        {!ccPlugins ? (
          <div style={{ padding: 40, textAlign: "center", color: "var(--text-muted)" }}>{loadFailed ? `Failed to load plugins: ${loadFailed}` : "Loading plugin catalog…"}</div>
        ) : tab === "installed" ? (
          <InstalledTable installed={ccPlugins.installed} isMobile={isMobile} busy={busy} onAction={runAction} onGoDiscover={() => setTab("discover")} />
        ) : tab === "discover" ? (
          <DiscoverList available={ccPlugins.available} isMobile={isMobile} busy={busy} onAction={runAction} />
        ) : (
          <MarketplacesTable marketplaces={ccPlugins.marketplaces} available={ccPlugins.available} isMobile={isMobile} busy={busy} onAction={runAction} />
        )}
      </div>
    </div>
  );
}

function Banner({ color, onDismiss, children }: { color: string; onDismiss: () => void; children: React.ReactNode }) {
  return (
    <div
      style={{
        padding: "8px 20px",
        borderBottom: "1px solid var(--border-subtle)",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 12,
        color,
        fontSize: 12,
      }}
    >
      <span style={{ whiteSpace: "pre-wrap", wordBreak: "break-word" }}>{children}</span>
      <button onClick={onDismiss} style={{ background: "none", border: "none", color: "var(--text-muted)", fontSize: 14, cursor: "pointer", flexShrink: 0 }}>
        ×
      </button>
    </div>
  );
}
