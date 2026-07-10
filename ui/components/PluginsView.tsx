import { useEffect, useMemo, useState } from "react";
import { useAppState, useDispatch } from "../store.tsx";
import type { CCAvailablePlugin, CCMarketplace, CCPluginScope, CCPluginsState } from "../../shared/types.ts";
import { InstalledTable } from "./PluginsInstalledTable.tsx";
import { ACTION_BTN, NameCell, SESSION_NOTE, tdStyle, thStyle } from "./PluginsViewShared.tsx";

// Claude Code plugin manager — Installed / Discover / Marketplaces. Mutations
// go through the HTTP API (server shells out to the headless `claude plugin`
// CLI); the server broadcasts the refreshed catalog to every browser, and the
// POST response carries the same snapshot so this tab updates immediately.

type Tab = "installed" | "discover" | "marketplaces";
const TAB_LABEL: Record<Tab, string> = { installed: "installed", discover: "discover", marketplaces: "marketplaces" };

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
            {(["installed", "discover", "marketplaces"] as Tab[]).map((t) => (
              <button
                key={t}
                onClick={() => setTab(t)}
                style={{
                  padding: "5px 12px",
                  border: "none",
                  background: tab === t ? "var(--accent)" : "transparent",
                  color: tab === t ? "var(--bg-base)" : "var(--text-muted)",
                  fontSize: 11,
                  fontWeight: 600,
                  cursor: "pointer",
                  textTransform: "capitalize",
                }}
              >
                {TAB_LABEL[t]}
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
          {refreshing ? "Refreshing…" : "Refresh"}
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

function DiscoverList({
  available,
  isMobile,
  busy,
  onAction,
}: {
  available: CCAvailablePlugin[];
  isMobile: boolean;
  busy: Set<string>;
  onAction: (key: string, fn: () => Promise<CCPluginsState>, doneNotice?: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [scope, setScope] = useState<CCPluginScope>("user");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const matches = q ? available.filter((p) => p.name.toLowerCase().includes(q) || (p.description ?? "").toLowerCase().includes(q) || p.marketplace.toLowerCase().includes(q)) : available;
    // Popular first; ties (and catalogs without counts) alphabetical.
    return [...matches].sort((a, b) => (b.installCount ?? 0) - (a.installCount ?? 0) || a.name.localeCompare(b.name));
  }, [available, query]);

  return (
    <div>
      <div
        style={{
          display: "flex",
          gap: 8,
          alignItems: "center",
          padding: isMobile ? "10px 12px" : "12px 20px",
          borderBottom: "1px solid var(--border-subtle)",
          position: "sticky",
          top: 0,
          background: "var(--bg-base)",
          zIndex: 10,
        }}
      >
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={`Search ${available.length} plugins…`}
          style={{
            flex: 1,
            maxWidth: 420,
            padding: "7px 12px",
            background: "var(--bg-input)",
            border: "1px solid var(--border)",
            borderRadius: 8,
            color: "var(--text-primary)",
            fontFamily: "'JetBrains Mono',monospace",
            fontSize: 12,
            outline: "none",
          }}
        />
        <label style={{ fontSize: 11, color: "var(--text-muted)", display: "flex", alignItems: "center", gap: 6 }}>
          {!isMobile && "Install scope:"}
          <select
            value={scope}
            onChange={(e) => setScope(e.target.value as CCPluginScope)}
            style={{ padding: "6px 8px", background: "var(--bg-input)", border: "1px solid var(--border)", borderRadius: 6, color: "var(--text-primary)", fontSize: 11 }}
          >
            <option value="user">user (global)</option>
            <option value="project">project</option>
            <option value="local">local</option>
          </select>
        </label>
      </div>

      {filtered.length === 0 ? (
        <div style={{ padding: 40, textAlign: "center", color: "var(--text-muted)" }}>
          {available.length === 0 ? "No marketplaces configured — add one in the Marketplaces tab." : "No plugins match your search."}
        </div>
      ) : (
        filtered.map((p) => {
          const installing = busy.has(`install:${p.id}`);
          return (
            <div
              key={p.id}
              style={{
                display: "flex",
                alignItems: "flex-start",
                justifyContent: "space-between",
                gap: 12,
                padding: isMobile ? "10px 12px" : "12px 20px",
                borderBottom: "1px solid var(--border-subtle)",
              }}
            >
              <NameCell name={p.name} description={p.description} sub={`@${p.marketplace}${p.version ? ` · v${p.version}` : ""}`} />
              <div style={{ display: "flex", alignItems: "center", gap: 10, flexShrink: 0 }}>
                {p.installCount !== undefined && !isMobile && (
                  <span style={{ fontSize: 11, color: "var(--text-muted)", fontFamily: "'JetBrains Mono',monospace" }}>{p.installCount.toLocaleString()} installs</span>
                )}
                {p.installed ? (
                  <span style={{ fontSize: 11, color: "var(--green)", whiteSpace: "nowrap" }}>✓ installed</span>
                ) : (
                  <button
                    onClick={() => onAction(`install:${p.id}`, () => postPlugins("/plugins/install", { plugin: p.id, scope }), `Installed ${p.name}. ${SESSION_NOTE}`)}
                    disabled={installing}
                    style={{
                      padding: "4px 12px",
                      borderRadius: 6,
                      border: "none",
                      background: "var(--accent)",
                      color: "var(--bg-base)",
                      fontSize: 11,
                      fontWeight: 600,
                      cursor: installing ? "default" : "pointer",
                      opacity: installing ? 0.6 : 1,
                      whiteSpace: "nowrap",
                    }}
                  >
                    {installing ? "Installing…" : "Install"}
                  </button>
                )}
              </div>
            </div>
          );
        })
      )}
    </div>
  );
}

function MarketplacesTable({
  marketplaces,
  available,
  isMobile,
  busy,
  onAction,
}: {
  marketplaces: CCMarketplace[];
  available: CCAvailablePlugin[];
  isMobile: boolean;
  busy: Set<string>;
  onAction: (key: string, fn: () => Promise<CCPluginsState>, doneNotice?: string) => void;
}) {
  const [source, setSource] = useState("");
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null);
  const adding = busy.has("marketplace:add");

  const countByMarketplace = useMemo(() => {
    const counts = new Map<string, number>();
    for (const p of available) counts.set(p.marketplace, (counts.get(p.marketplace) ?? 0) + 1);
    return counts;
  }, [available]);

  function handleAdd() {
    const trimmed = source.trim();
    if (!trimmed || adding) return;
    onAction("marketplace:add", () => postPlugins("/plugins/marketplace/add", { source: trimmed }));
    setSource("");
  }

  const th = thStyle(isMobile);
  const td = tdStyle(isMobile);
  return (
    <div>
      <div style={{ display: "flex", gap: 8, padding: isMobile ? "10px 12px" : "12px 20px", borderBottom: "1px solid var(--border-subtle)" }}>
        <input
          value={source}
          onChange={(e) => setSource(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleAdd()}
          placeholder="owner/repo, git URL, or local path"
          style={{
            flex: 1,
            maxWidth: 420,
            padding: "7px 12px",
            background: "var(--bg-input)",
            border: "1px solid var(--border)",
            borderRadius: 8,
            color: "var(--text-primary)",
            fontFamily: "'JetBrains Mono',monospace",
            fontSize: 12,
            outline: "none",
          }}
        />
        <button
          onClick={handleAdd}
          disabled={adding || !source.trim()}
          style={{
            padding: "4px 12px",
            borderRadius: 6,
            border: "none",
            background: "var(--accent)",
            color: "var(--bg-base)",
            fontSize: 11,
            fontWeight: 600,
            cursor: adding || !source.trim() ? "default" : "pointer",
            opacity: adding || !source.trim() ? 0.6 : 1,
          }}
        >
          {adding ? "Adding…" : "+ Add"}
        </button>
      </div>

      {marketplaces.length === 0 ? (
        <div style={{ padding: 40, textAlign: "center", color: "var(--text-muted)" }}>No marketplaces configured. Add one above (e.g. anthropics/claude-plugins-official).</div>
      ) : (
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr>
              <th style={th}>NAME</th>
              <th style={th}>SOURCE</th>
              {!isMobile && <th style={th}>PLUGINS</th>}
              <th style={{ ...th, width: 100 }}></th>
            </tr>
          </thead>
          <tbody>
            {marketplaces.map((m) => {
              const removing = busy.has(`marketplace:remove:${m.name}`);
              return (
                <tr key={m.name}>
                  <td style={{ ...td, fontWeight: 600, fontFamily: "'JetBrains Mono',monospace" }}>{m.name}</td>
                  <td style={{ ...td, color: "var(--text-dim)", fontFamily: "'JetBrains Mono',monospace", fontSize: 11, wordBreak: "break-all" }}>{m.repo ?? m.url ?? m.source}</td>
                  {!isMobile && <td style={{ ...td, color: "var(--text-dim)" }}>{countByMarketplace.get(m.name) ?? 0}</td>}
                  <td style={{ ...td, textAlign: "right" }}>
                    <button
                      onClick={() => {
                        if (confirmRemove !== m.name) {
                          setConfirmRemove(m.name);
                          return;
                        }
                        setConfirmRemove(null);
                        onAction(`marketplace:remove:${m.name}`, () => postPlugins("/plugins/marketplace/remove", { name: m.name }));
                      }}
                      onBlur={() => setConfirmRemove((c) => (c === m.name ? null : c))}
                      disabled={removing}
                      style={{
                        ...ACTION_BTN,
                        border: `1px solid ${confirmRemove === m.name ? "var(--red)" : "var(--border)"}`,
                        background: confirmRemove === m.name ? "var(--red)" : "transparent",
                        color: confirmRemove === m.name ? "var(--bg-base)" : "var(--red)",
                        opacity: removing ? 0.6 : 1,
                      }}
                    >
                      {removing ? "…" : confirmRemove === m.name ? "Confirm?" : "Remove"}
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}
