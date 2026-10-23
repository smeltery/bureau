import { useI18n } from "../i18n.tsx";
import { scheduleDescription, lastRunTime, nextRunTime } from "./schedules/format.ts";
import { useAppState } from "../store.tsx";
import { useState, type CSSProperties } from "react";
import { type Cronjob, type CronjobRun } from "../../shared/types.ts";
import { StatusShape } from "../icons/StatusShape.tsx";

export function CronjobsTable({
  cronjobs,
  loaded,
  runsByJob,
  isMobile,
  onRowClick,
  onEdit,
  onToggleEnabled,
  onRunNow,
}: {
  cronjobs: Cronjob[];
  loaded: boolean;
  runsByJob: Map<string, CronjobRun[]>;
  isMobile: boolean;
  onRowClick: (c: Cronjob) => void;
  onEdit: (c: Cronjob) => void;
  onToggleEnabled: (c: Cronjob) => void;
  onRunNow: (c: Cronjob) => void;
}) {
  const { t, language } = useI18n();
  const number = new Intl.NumberFormat(language);
  const { sessionContext } = useAppState();
  const canManage = (job: Cronjob) => sessionContext?.role === "owner" || (!!sessionContext?.userId && job.userId === sessionContext.userId);
  // Brief visual ack after clicking Run. Cleared after 1.8s so subsequent
  // clicks always re-flash. The persistent in-flight badge (below) is the
  // longer-lived signal that something is actually executing.
  const [justStarted, setJustStarted] = useState<Set<string>>(new Set());
  function handleRunClick(c: Cronjob) {
    onRunNow(c);
    setJustStarted((prev) => new Set(prev).add(c.id));
    setTimeout(() => {
      setJustStarted((prev) => {
        const next = new Set(prev);
        next.delete(c.id);
        return next;
      });
    }, 1800);
  }
  const cellPad = isMobile ? "8px 6px" : "10px 12px";
  const thStyle: CSSProperties = {
    padding: cellPad,
    fontSize: 10,
    fontWeight: 700,
    color: "var(--text-muted)",
    fontFamily: "'JetBrains Mono',monospace",
    letterSpacing: "0.05em",
    textAlign: "left",
    whiteSpace: "nowrap",
    borderBottom: "1px solid var(--border-subtle)",
  };

  if (cronjobs.length === 0) {
    return <div style={{ padding: 40, textAlign: "center", color: "var(--text-muted)" }}>{loaded ? t("schedules.empty") : t("common.loadingDots")}</div>;
  }

  return (
    <table style={{ width: "100%", borderCollapse: "collapse" }}>
      <thead>
        <tr>
          <th style={{ ...thStyle, width: 30 }}></th>
          <th style={thStyle}>{t("common.name")}</th>
          {!isMobile && <th style={thStyle}>{t("schedules.column.schedule")}</th>}
          {!isMobile && <th style={thStyle}>{t("schedules.column.last")}</th>}
          <th style={thStyle}>{t("schedules.column.next")}</th>
          <th style={{ ...thStyle, width: 80 }}>{t("schedules.column.runs")}</th>
          {!isMobile && <th style={thStyle}>{t("schedules.column.by")}</th>}
          <th style={{ ...thStyle, width: 130 }}></th>
        </tr>
      </thead>
      <tbody>
        {cronjobs.map((c) => {
          const runs = runsByJob.get(c.id) ?? [];
          return (
            <tr
              key={c.id}
              onClick={() => onRowClick(c)}
              style={{
                cursor: "pointer",
                borderBottom: "1px solid var(--border-subtle)",
                opacity: c.enabled ? 1 : 0.55,
              }}
              onMouseEnter={(e) => (e.currentTarget.style.background = "var(--bg-hover)")}
              onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
            >
              <td
                style={{ padding: cellPad }}
                onClick={(e) => {
                  e.stopPropagation();
                  if (canManage(c)) onToggleEnabled(c);
                }}
              >
                <span
                  title={c.enabled ? t("schedules.enabledToggle") : t("schedules.pausedToggle")}
                  style={{
                    display: "inline-block",
                    width: 10,
                    height: 10,
                    borderRadius: "50%",
                    background: c.enabled ? "var(--green)" : "var(--text-muted)",
                    boxShadow: c.enabled ? "0 0 6px var(--green)" : "none",
                  }}
                />
              </td>
              <td style={{ padding: cellPad, fontSize: 13, fontWeight: 600 }}>
                {c.name}
                {(() => {
                  const inFlight = runs.filter((r) => r.status === "running").length;
                  if (inFlight === 0) return null;
                  return (
                    <span
                      style={{
                        marginLeft: 8,
                        padding: "1px 7px",
                        borderRadius: 10,
                        background: "rgba(80,200,120,0.15)",
                        border: "1px solid var(--green)",
                        color: "var(--green)",
                        fontSize: 10,
                        fontWeight: 600,
                        fontFamily: "'JetBrains Mono',monospace",
                        verticalAlign: "middle",
                      }}
                    >
                      <StatusShape kind="dot" /> {t("schedules.running")}
                      {inFlight > 1 ? ` ×${number.format(inFlight)}` : ""}
                    </span>
                  );
                })()}
              </td>
              {!isMobile && <td style={{ padding: cellPad, fontSize: 12, color: "var(--text-secondary)", fontFamily: "'JetBrains Mono',monospace" }}>{scheduleDescription(c.schedule, language)}</td>}
              {!isMobile && <td style={{ padding: cellPad, fontSize: 11, color: "var(--text-muted)", fontFamily: "'JetBrains Mono',monospace" }}>{lastRunTime(c.lastFireAt, language)}</td>}
              <td style={{ padding: cellPad, fontSize: 11, color: c.enabled ? "var(--text-secondary)" : "var(--text-ghost)", fontFamily: "'JetBrains Mono',monospace" }}>
                {c.schedule.type === "manual" ? t("schedules.manual") : !c.enabled ? t("common.paused") : c.nextFireAt === null ? "—" : nextRunTime(c.nextFireAt, language)}
              </td>
              <td style={{ padding: cellPad, fontSize: 11, color: "var(--text-muted)", fontFamily: "'JetBrains Mono',monospace" }}>{number.format(runs.length)}</td>
              {!isMobile && (
                <td style={{ padding: cellPad, fontSize: 11, color: "var(--text-muted)", fontFamily: "'JetBrains Mono',monospace" }}>
                  {c.username && c.username !== c.createdBy ? t("schedules.forMember", { creator: c.createdBy, member: c.username }) : c.createdBy}
                  {c.device && c.device !== c.createdBy && c.device !== c.username ? ` (${c.device})` : ""}
                </td>
              )}
              <td style={{ padding: cellPad, whiteSpace: "nowrap", textAlign: "right" }} onClick={(e) => e.stopPropagation()}>
                <div style={{ display: "inline-flex", gap: 6, flexWrap: "nowrap" }}>
                  <button
                    disabled={!canManage(c)}
                    onClick={() => handleRunClick(c)}
                    title={t("schedules.runNow")}
                    style={{
                      padding: "3px 10px",
                      borderRadius: 4,
                      border: `1px solid ${justStarted.has(c.id) ? "var(--green)" : "var(--border)"}`,
                      background: justStarted.has(c.id) ? "rgba(80,200,120,0.15)" : "transparent",
                      color: justStarted.has(c.id) ? "var(--green)" : "var(--text-dim)",
                      fontSize: 11,
                      cursor: "pointer",
                      whiteSpace: "nowrap",
                      transition: "background 0.2s, color 0.2s, border-color 0.2s",
                    }}
                  >
                    {t("schedules.run")}
                  </button>
                  <button
                    disabled={!canManage(c)}
                    onClick={() => onEdit(c)}
                    title={t("common.edit")}
                    style={{
                      padding: "3px 10px",
                      borderRadius: 4,
                      border: "1px solid var(--border)",
                      background: "transparent",
                      color: "var(--text-dim)",
                      fontSize: 11,
                      cursor: "pointer",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {t("common.edit")}
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
