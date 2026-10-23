import { useI18n } from "../i18n.tsx";
import { runDuration, runStartedAt, runTrigger } from "./schedules/format.ts";
import { useEffect, useState, type ReactNode } from "react";
import type { CronjobRun, CronjobRunStatus } from "../../shared/types.ts";
import { StatusShape } from "../icons/StatusShape.tsx";

const STATUS_ICON: Record<CronjobRunStatus, ReactNode> = {
  running: <StatusShape kind="dot" />,
  completed: <StatusShape kind="check" />,
  failed: "✗",
  timed_out: "⏱",
  skipped: "⊘",
};

const STATUS_COLOR: Record<CronjobRunStatus, string> = {
  running: "var(--green)",
  completed: "var(--text-secondary)",
  failed: "var(--red)",
  timed_out: "var(--orange, #d29922)",
  skipped: "var(--text-muted)",
};

export function RunsTable({
  runs,
  loaded,
  liveCronjobIds,
  isMobile,
  onRowClick,
}: {
  runs: CronjobRun[];
  loaded: boolean;
  liveCronjobIds: Set<string>;
  isMobile: boolean;
  onRowClick: (r: CronjobRun) => void;
}) {
  const { t, language } = useI18n();
  const number = new Intl.NumberFormat(language);
  const cellPad = isMobile ? "8px 6px" : "10px 12px";
  const thStyle: React.CSSProperties = {
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
  const PAGE_SIZE = 50;
  const [page, setPage] = useState(0);
  useEffect(() => {
    setPage(0);
  }, [runs.length]);
  const pageStart = page * PAGE_SIZE;
  const pageRuns = runs.slice(pageStart, pageStart + PAGE_SIZE);
  const totalPages = Math.max(1, Math.ceil(runs.length / PAGE_SIZE));

  if (runs.length === 0) {
    return <div style={{ padding: 40, textAlign: "center", color: "var(--text-muted)" }}>{loaded ? t("schedules.runsEmpty") : t("common.loadingDots")}</div>;
  }

  return (
    <>
      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead>
          <tr>
            <th style={{ ...thStyle, width: 30 }}>{t("schedules.column.status")}</th>
            <th style={{ ...thStyle, width: 30 }}>{t("schedules.column.trigger")}</th>
            <th style={thStyle}>{t("schedules.column.schedule")}</th>
            <th style={thStyle}>{t("schedules.column.started")}</th>
            <th style={thStyle}>{t("common.preview")}</th>
            {!isMobile && <th style={{ ...thStyle, width: 80 }}>{t("schedules.column.duration")}</th>}
          </tr>
        </thead>
        <tbody>
          {pageRuns.map((r) => (
            <tr
              key={r.id}
              onClick={() => onRowClick(r)}
              style={{
                cursor: "pointer",
                borderBottom: "1px solid var(--border-subtle)",
              }}
              onMouseEnter={(e) => (e.currentTarget.style.background = "var(--bg-hover)")}
              onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
            >
              <td style={{ padding: cellPad, color: STATUS_COLOR[r.status], fontSize: 14, textAlign: "center" }} title={t(`schedules.status.${r.status === "timed_out" ? "timedOut" : r.status}`)}>
                {STATUS_ICON[r.status]}
              </td>
              <td style={{ padding: cellPad, color: "var(--text-muted)", fontSize: 12, textAlign: "center" }} title={runTrigger(r, language)}>
                {r.trigger === "manual" ? <StatusShape kind="triangle" /> : r.trigger === "webhook" ? "↪" : "⏲"}
              </td>
              <td style={{ padding: cellPad, fontSize: 12, fontWeight: 600 }}>
                {r.cronjobName}
                {!liveCronjobIds.has(r.cronjobId) && <span style={{ marginLeft: 6, color: "var(--text-ghost)", fontWeight: 400, fontStyle: "italic", fontSize: 11 }}>{t("schedules.deleted")}</span>}
              </td>
              <td style={{ padding: cellPad, fontSize: 11, color: "var(--text-muted)", fontFamily: "'JetBrains Mono',monospace", whiteSpace: "nowrap" }}>{runStartedAt(r.startedAt, language)}</td>
              <td
                style={{
                  padding: cellPad,
                  fontSize: 11,
                  color: r.errorReason ? "var(--red)" : "var(--text-secondary)",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                  maxWidth: 0,
                }}
              >
                {r.errorReason || r.previewText || "—"}
              </td>
              {!isMobile && <td style={{ padding: cellPad, fontSize: 11, color: "var(--text-muted)", fontFamily: "'JetBrains Mono',monospace" }}>{runDuration(r.startedAt, r.endedAt, language)}</td>}
            </tr>
          ))}
        </tbody>
      </table>
      {totalPages > 1 && (
        <div style={{ display: "flex", justifyContent: "center", alignItems: "center", gap: 12, padding: "12px 0" }}>
          <button onClick={() => setPage((p) => Math.max(0, p - 1))} disabled={page === 0} style={pagerBtn(page === 0)}>
            {t("schedules.previous")}
          </button>
          <span style={{ fontSize: 11, color: "var(--text-muted)", fontFamily: "'JetBrains Mono',monospace" }}>
            {number.format(page + 1)} / {number.format(totalPages)}
          </span>
          <button onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))} disabled={page >= totalPages - 1} style={pagerBtn(page >= totalPages - 1)}>
            {t("schedules.next")}
          </button>
        </div>
      )}
    </>
  );
}

function pagerBtn(disabled: boolean): React.CSSProperties {
  return {
    padding: "4px 10px",
    borderRadius: 6,
    border: "1px solid var(--border)",
    background: "transparent",
    color: disabled ? "var(--text-ghost)" : "var(--text-dim)",
    fontSize: 11,
    cursor: disabled ? "default" : "pointer",
  };
}
