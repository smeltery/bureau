import { useMemo, useState } from "react";
import type { CCAvailablePlugin, CCMarketplace, CCPluginsState } from "../../shared/types.ts";
import { ACTION_BTN, tdStyle, thStyle } from "./PluginsViewShared.tsx";

export function MarketplacesTable({
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
