import { useState } from "react";
import type { CCInstalledPlugin, CCPluginsState } from "../../shared/types.ts";
import { ACTION_BTN, NameCell, SESSION_NOTE, tdStyle, thStyle } from "./PluginsViewShared.tsx";

export function InstalledTable({
  installed,
  isMobile,
  busy,
  onAction,
  onGoDiscover,
}: {
  installed: CCInstalledPlugin[];
  isMobile: boolean;
  busy: Set<string>;
  onAction: (key: string, fn: () => Promise<CCPluginsState>, doneNotice?: string) => void;
  onGoDiscover: () => void;
}) {
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null);

  if (installed.length === 0) {
    return (
      <div style={{ padding: 40, textAlign: "center", color: "var(--text-muted)" }}>
        No plugins installed.{" "}
        <button onClick={onGoDiscover} style={{ background: "none", border: "none", color: "var(--accent)", cursor: "pointer", fontSize: "inherit", padding: 0 }}>
          Browse the marketplace →
        </button>
      </div>
    );
  }

  const th = thStyle(isMobile);
  const td = tdStyle(isMobile);
  return (
    <table style={{ width: "100%", borderCollapse: "collapse" }}>
      <thead>
        <tr>
          <th style={th}>PLUGIN</th>
          {!isMobile && <th style={th}>VERSION</th>}
          {!isMobile && <th style={th}>SCOPE</th>}
          <th style={th}>STATUS</th>
          <th style={{ ...th, width: isMobile ? 120 : 230 }}></th>
        </tr>
      </thead>
      <tbody>
        {installed.map((p) => {
          const toggling = busy.has(`toggle:${p.id}`);
          const updating = busy.has(`update:${p.id}`);
          const removing = busy.has(`remove:${p.id}`);
          return (
            <tr key={p.id}>
              <td style={td}>
                <NameCell name={p.name} description={p.description} sub={`@${p.marketplace}`} />
              </td>
              {!isMobile && <td style={{ ...td, fontFamily: "'JetBrains Mono',monospace", color: "var(--text-dim)" }}>{p.version || "—"}</td>}
              {!isMobile && <td style={{ ...td, color: "var(--text-dim)" }}>{p.scope}</td>}
              <td style={{ ...td, color: p.enabled ? "var(--green)" : "var(--text-muted)", whiteSpace: "nowrap" }}>{p.enabled ? "● enabled" : "○ disabled"}</td>
              <td style={{ ...td, textAlign: "right" }}>
                <div style={{ display: "inline-flex", gap: 6, flexWrap: "wrap", justifyContent: "flex-end" }}>
                  <button
                    onClick={() => onAction(`toggle:${p.id}`, () => postPlugins(p.enabled ? "/plugins/disable" : "/plugins/enable", { plugin: p.id }), p.enabled ? undefined : SESSION_NOTE)}
                    disabled={toggling}
                    style={{ ...ACTION_BTN, opacity: toggling ? 0.6 : 1 }}
                  >
                    {toggling ? "…" : p.enabled ? "Disable" : "Enable"}
                  </button>
                  {!isMobile && (
                    <button
                      onClick={() => onAction(`update:${p.id}`, () => postPlugins("/plugins/update", { plugin: p.id }))}
                      disabled={updating}
                      style={{ ...ACTION_BTN, opacity: updating ? 0.6 : 1 }}
                    >
                      {updating ? "…" : "Update"}
                    </button>
                  )}
                  <button
                    onClick={() => {
                      if (confirmRemove !== p.id) {
                        setConfirmRemove(p.id);
                        return;
                      }
                      setConfirmRemove(null);
                      onAction(`remove:${p.id}`, () => postPlugins("/plugins/remove", { plugin: p.id }));
                    }}
                    onBlur={() => setConfirmRemove((c) => (c === p.id ? null : c))}
                    disabled={removing}
                    style={{
                      ...ACTION_BTN,
                      border: `1px solid ${confirmRemove === p.id ? "var(--red)" : "var(--border)"}`,
                      background: confirmRemove === p.id ? "var(--red)" : "transparent",
                      color: confirmRemove === p.id ? "var(--bg-base)" : "var(--red)",
                      opacity: removing ? 0.6 : 1,
                    }}
                  >
                    {removing ? "…" : confirmRemove === p.id ? "Confirm?" : "Remove"}
                  </button>
                </div>
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
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
