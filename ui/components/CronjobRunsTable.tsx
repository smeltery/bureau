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
    return <div style={{ padding: 40, textAlign: "center", color: "var(--text-muted)" }}>{loaded ? "No runs yet." : "Loading..."}</div>;
  }

  return (
    <>
      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead>
          <tr>
            <th style={{ ...thStyle, width: 30 }}>S</th>
            <th style={{ ...thStyle, width: 30 }}>T</th>
            <th style={thStyle}>CRONJOB</th>
            <th style={thStyle}>STARTED</th>
            <th style={thStyle}>PREVIEW</th>
            {!isMobile && <th style={{ ...thStyle, width: 80 }}>DURATION</th>}
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
              <td style={{ padding: cellPad, color: STATUS_COLOR[r.status], fontSize: 14, textAlign: "center" }} title={r.status}>
                {STATUS_ICON[r.status]}
              </td>
              <td style={{ padding: cellPad, color: "var(--text-muted)", fontSize: 12, textAlign: "center" }} title={r.trigger === "manual" && r.triggeredBy ? `manual · ${r.triggeredBy}` : r.trigger}>
                {r.trigger === "manual" ? <StatusShape kind="triangle" /> : "⏲"}
              </td>
              <td style={{ padding: cellPad, fontSize: 12, fontWeight: 600 }}>
                {r.cronjobName}
                {!liveCronjobIds.has(r.cronjobId) && <span style={{ marginLeft: 6, color: "var(--text-ghost)", fontWeight: 400, fontStyle: "italic", fontSize: 11 }}>(deleted)</span>}
              </td>
              <td style={{ padding: cellPad, fontSize: 11, color: "var(--text-muted)", fontFamily: "'JetBrains Mono',monospace", whiteSpace: "nowrap" }}>{formatStartedAt(r.startedAt)}</td>
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
              {!isMobile && <td style={{ padding: cellPad, fontSize: 11, color: "var(--text-muted)", fontFamily: "'JetBrains Mono',monospace" }}>{formatDuration(r.startedAt, r.endedAt)}</td>}
            </tr>
          ))}
        </tbody>
      </table>
      {totalPages > 1 && (
        <div style={{ display: "flex", justifyContent: "center", alignItems: "center", gap: 12, padding: "12px 0" }}>
          <button onClick={() => setPage((p) => Math.max(0, p - 1))} disabled={page === 0} style={pagerBtn(page === 0)}>
            ← Prev
          </button>
          <span style={{ fontSize: 11, color: "var(--text-muted)", fontFamily: "'JetBrains Mono',monospace" }}>
            {page + 1} / {totalPages}
          </span>
          <button onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))} disabled={page >= totalPages - 1} style={pagerBtn(page >= totalPages - 1)}>
            Next →
          </button>
        </div>
      )}
    </>
  );
}

function formatDuration(start: number, end: number | null): string {
  if (!end) return "running…";
  const sec = Math.floor((end - start) / 1000);
  if (sec < 60) return `${sec}s`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ${sec % 60}s`;
  const hr = Math.floor(min / 60);
  return `${hr}h ${min % 60}m`;
}

function formatStartedAt(ts: number): string {
  const d = new Date(ts);
  const today = new Date();
  const sameDay = d.toDateString() === today.toDateString();
  const time = d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  if (sameDay) return time;
  return `${d.toLocaleDateString([], { month: "short", day: "numeric" })} ${time}`;
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
