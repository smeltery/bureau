import { useMemo, useState } from "react";
import type { CCAvailablePlugin, CCPluginScope, CCPluginsState } from "../../shared/types.ts";
import { StatusShape } from "../icons/StatusShape.tsx";
import { NameCell, SESSION_NOTE } from "./PluginsViewShared.tsx";

export function DiscoverList({
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
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 11, color: "var(--green)", whiteSpace: "nowrap" }}>
                    <StatusShape kind="check" /> installed
                  </span>
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
