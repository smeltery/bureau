import { useState, type CSSProperties } from "react";
import { humanizeSchedule, type Cronjob, type CronjobRun } from "../../shared/types.ts";

function timeAgo(ts: number | null): string {
  if (!ts) return "—";
  const diff = Date.now() - ts;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function timeUntil(ts: number): string {
  const diff = ts - Date.now();
  if (diff <= 0) return "any moment";
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "<1m";
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h${mins % 60 ? ` ${mins % 60}m` : ""}`;
  const days = Math.floor(hours / 24);
  return `${days}d ${hours % 24}h`;
}

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
    return <div style={{ padding: 40, textAlign: "center", color: "var(--text-muted)" }}>{loaded ? `No schedules yet. Click "+ New" to create one.` : "Loading..."}</div>;
  }

  return (
    <table style={{ width: "100%", borderCollapse: "collapse" }}>
      <thead>
        <tr>
          <th style={{ ...thStyle, width: 30 }}></th>
          <th style={thStyle}>NAME</th>
          {!isMobile && <th style={thStyle}>SCHEDULE</th>}
          {!isMobile && <th style={thStyle}>LAST RUN</th>}
          <th style={thStyle}>NEXT RUN</th>
          <th style={{ ...thStyle, width: 80 }}>RUNS</th>
          {!isMobile && <th style={thStyle}>BY</th>}
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
                  onToggleEnabled(c);
                }}
              >
                <span
                  title={c.enabled ? "Enabled (click to pause)" : "Paused (click to enable)"}
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
                      ● running{inFlight > 1 ? ` ×${inFlight}` : ""}
                    </span>
                  );
                })()}
              </td>
              {!isMobile && <td style={{ padding: cellPad, fontSize: 12, color: "var(--text-secondary)", fontFamily: "'JetBrains Mono',monospace" }}>{humanizeSchedule(c.schedule)}</td>}
              {!isMobile && <td style={{ padding: cellPad, fontSize: 11, color: "var(--text-muted)", fontFamily: "'JetBrains Mono',monospace" }}>{timeAgo(c.lastFireAt)}</td>}
              <td style={{ padding: cellPad, fontSize: 11, color: c.enabled ? "var(--text-secondary)" : "var(--text-ghost)", fontFamily: "'JetBrains Mono',monospace" }}>
                {c.enabled ? `in ${timeUntil(c.nextFireAt)}` : "paused"}
              </td>
              <td style={{ padding: cellPad, fontSize: 11, color: "var(--text-muted)", fontFamily: "'JetBrains Mono',monospace" }}>{runs.length}</td>
              {!isMobile && (
                <td style={{ padding: cellPad, fontSize: 11, color: "var(--text-muted)", fontFamily: "'JetBrains Mono',monospace" }}>
                  {c.username && c.username !== c.createdBy ? `${c.createdBy} · for ${c.username}` : c.createdBy}
                  {c.device && c.device !== c.createdBy && c.device !== c.username ? ` (${c.device})` : ""}
                </td>
              )}
              <td style={{ padding: cellPad, whiteSpace: "nowrap", textAlign: "right" }} onClick={(e) => e.stopPropagation()}>
                <div style={{ display: "inline-flex", gap: 6, flexWrap: "nowrap" }}>
                  <button
                    onClick={() => handleRunClick(c)}
                    title="Run now"
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
                    Run
                  </button>
                  <button
                    onClick={() => onEdit(c)}
                    title="Edit"
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
                    Edit
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
