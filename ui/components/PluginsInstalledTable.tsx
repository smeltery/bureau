import { useI18n } from "../i18n.tsx";
import { pluginRequest as postPlugins, type PluginAction } from "./plugins/api.ts";
import { useState } from "react";
import type { CCInstalledPlugin } from "../../shared/types.ts";
import { StatusShape } from "../icons/StatusShape.tsx";
import { ACTION_BTN, NameCell, tdStyle, thStyle } from "./PluginsViewShared.tsx";

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
  onAction: PluginAction;
  onGoDiscover: () => void;
}) {
  const { t } = useI18n();
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null);

  if (installed.length === 0) {
    return (
      <div style={{ padding: 40, textAlign: "center", color: "var(--text-muted)" }}>
        {t("pluginsUi.empty")}{" "}
        <button onClick={onGoDiscover} style={{ background: "none", border: "none", color: "var(--accent)", cursor: "pointer", fontSize: "inherit", padding: 0 }}>
          {t("pluginsUi.browse")}
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
          <th style={th}>{t("pluginsUi.plugin")}</th>
          {!isMobile && <th style={th}>{t("pluginsUi.version")}</th>}
          {!isMobile && <th style={th}>{t("pluginsUi.scope")}</th>}
          <th style={th}>{t("common.status")}</th>
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
              {!isMobile && (
                <td style={{ ...td, color: "var(--text-dim)" }}>
                  {t(p.scope === "user" ? "pluginsUi.scopeUser" : p.scope === "project" ? "pluginsUi.scopeProject" : p.scope === "local" ? "pluginsUi.scopeLocal" : "pluginsUi.scopeManaged")}
                </td>
              )}
              <td style={{ ...td, color: p.enabled ? "var(--green)" : "var(--text-muted)", whiteSpace: "nowrap" }}>
                <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
                  <StatusShape kind="dot" hollow={!p.enabled} /> {p.enabled ? t("common.enabled") : t("common.disabled")}
                </span>
              </td>
              <td style={{ ...td, textAlign: "right" }}>
                <div style={{ display: "inline-flex", gap: 6, flexWrap: "wrap", justifyContent: "flex-end" }}>
                  <button
                    onClick={() => onAction(`toggle:${p.id}`, () => postPlugins(p.enabled ? "/plugins/disable" : "/plugins/enable", { plugin: p.id }), p.enabled ? undefined : { session: true })}
                    disabled={toggling}
                    style={{ ...ACTION_BTN, opacity: toggling ? 0.6 : 1 }}
                  >
                    {toggling ? "…" : p.enabled ? t("common.disable") : t("common.enable")}
                  </button>
                  {!isMobile && (
                    <button
                      onClick={() => onAction(`update:${p.id}`, () => postPlugins("/plugins/update", { plugin: p.id }))}
                      disabled={updating}
                      style={{ ...ACTION_BTN, opacity: updating ? 0.6 : 1 }}
                    >
                      {updating ? "…" : t("common.update")}
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
                    {removing ? "…" : confirmRemove === p.id ? t("common.confirmQuestion") : t("common.remove")}
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
