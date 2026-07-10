import { useEffect, useMemo, useState } from "react";
import { useAppState } from "../store.tsx";
import { send } from "../ws.ts";
import { CronjobDialog } from "./modals/CronjobDialog.tsx";
import { CronjobsPromptDialog } from "./modals/CronjobsPromptDialog.tsx";
import { CronjobRunView } from "./CronjobRunView.tsx";
import { RunsTable } from "./CronjobRunsTable.tsx";
import { humanizeSchedule, type Cronjob, type CronjobRun } from "../../shared/types.ts";

type Tab = "runs" | "cronjobs";
const TAB_LABEL: Record<Tab, string> = { runs: "runs", cronjobs: "cron jobs" };

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

export function CronjobsView({ username, onClose }: { username: string; onClose: () => void }) {
  const { cronjobs, cronjobsLoaded, cronjobRunsByJob, cronjobRunsLoaded, isMobile } = useAppState();
  const [tab, setTab] = useState<Tab>("runs");
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<Cronjob | null>(null);
  const [editingPrompt, setEditingPrompt] = useState(false);
  const [runFilter, setRunFilter] = useState<{ jobId: string; jobName: string } | null>(null);
  const [openRun, setOpenRun] = useState<{ jobId: string; runId: string } | null>(null);

  // Request runs from every cronjob dir on disk (including deleted ones), so
  // historical runs from deleted cronjobs still appear in the Runs tab.
  // Fires on first mount and whenever the live cronjob list changes (e.g. a
  // new cronjob was just created — its runs.json will appear on disk on first
  // fire and we'd want to pick it up on the next refresh).
  useEffect(() => {
    send({ type: "list_all_cronjob_runs" });
  }, [cronjobs.length]);

  // Re-request runs for a specific job when the user pins a filter to it,
  // so the table is current even if the websocket dropped previous updates.
  useEffect(() => {
    if (runFilter) send({ type: "list_cronjob_runs", cronjobId: runFilter.jobId });
  }, [runFilter?.jobId]);

  const allRuns: CronjobRun[] = useMemo(() => {
    const all: CronjobRun[] = [];
    for (const runs of cronjobRunsByJob.values()) all.push(...runs);
    return all.sort((a, b) => b.startedAt - a.startedAt);
  }, [cronjobRunsByJob]);

  const filteredRuns = useMemo(() => {
    if (!runFilter) return allRuns;
    return allRuns.filter((r) => r.cronjobId === runFilter.jobId);
  }, [allRuns, runFilter]);

  // ESC closes (handled at App level by goHome → popstate; local Escape just dismisses our overlays)
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        if (openRun) {
          e.stopPropagation();
          setOpenRun(null);
          return;
        }
        if (editing || creating || editingPrompt) {
          e.stopPropagation();
          setEditing(null);
          setCreating(false);
          setEditingPrompt(false);
          return;
        }
      }
    }
    window.addEventListener("keydown", handleKey, true);
    return () => window.removeEventListener("keydown", handleKey, true);
  }, [openRun, editing, creating, editingPrompt]);

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
      {/* Header. Use minHeight (not height) so the safe-area-inset-top
          padding extends the bar below the camera notch instead of being
          squashed into the 44px box (box-sizing: border-box is global). */}
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
          <button
            onClick={onClose}
            style={{
              background: "none",
              border: "none",
              color: "var(--text-muted)",
              fontSize: 18,
              cursor: "pointer",
              padding: "2px 8px",
            }}
          >
            ←
          </button>
          <div style={{ display: "flex", border: "1px solid var(--border)", borderRadius: 6, overflow: "hidden" }}>
            {(["runs", "cronjobs"] as Tab[]).map((t) => (
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
        <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
          <button
            onClick={() => setEditingPrompt(true)}
            style={{
              padding: "4px 10px",
              borderRadius: 6,
              border: "1px solid var(--border)",
              background: "transparent",
              color: "var(--text-dim)",
              fontSize: 11,
              cursor: "pointer",
            }}
          >
            Settings
          </button>
          <button
            onClick={() => setCreating(true)}
            style={{
              padding: "4px 10px",
              borderRadius: 6,
              border: "none",
              background: "var(--accent)",
              color: "var(--bg-base)",
              fontSize: 11,
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            + New
          </button>
        </div>
      </div>

      {/* Filter chip */}
      {tab === "runs" && runFilter && (
        <div style={{ padding: "8px 20px", borderBottom: "1px solid var(--border-subtle)", display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 11, color: "var(--text-muted)" }}>Cron job:</span>
          <button
            onClick={() => setRunFilter(null)}
            style={{
              padding: "3px 8px 3px 10px",
              borderRadius: 12,
              border: "1px solid var(--accent)",
              background: "var(--accent-muted, rgba(88,166,255,0.15))",
              color: "var(--accent)",
              fontSize: 11,
              cursor: "pointer",
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              fontFamily: "'JetBrains Mono',monospace",
            }}
          >
            {runFilter.jobName}
            <span style={{ fontSize: 13, opacity: 0.7 }}>×</span>
          </button>
        </div>
      )}

      {/* Body */}
      <div style={{ flex: 1, overflow: "auto" }}>
        {tab === "cronjobs" ? (
          <CronjobsTable
            cronjobs={cronjobs}
            loaded={cronjobsLoaded}
            runsByJob={cronjobRunsByJob}
            isMobile={isMobile}
            onRowClick={(c) => {
              setRunFilter({ jobId: c.id, jobName: c.name });
              setTab("runs");
            }}
            onEdit={(c) => setEditing(c)}
            onToggleEnabled={(c) => send({ type: "update_cronjob", id: c.id, changes: { enabled: !c.enabled } })}
            onRunNow={(c) => send({ type: "run_cronjob_now", id: c.id, username })}
          />
        ) : (
          <RunsTable
            runs={filteredRuns}
            loaded={cronjobRunsLoaded}
            liveCronjobIds={new Set(cronjobs.map((c) => c.id))}
            isMobile={isMobile}
            onRowClick={(r) => setOpenRun({ jobId: r.cronjobId, runId: r.id })}
          />
        )}
      </div>

      {creating && <CronjobDialog username={username} onClose={() => setCreating(false)} />}
      {editing && <CronjobDialog cronjob={editing} username={username} onClose={() => setEditing(null)} />}
      {editingPrompt && <CronjobsPromptDialog onClose={() => setEditingPrompt(false)} />}
      {openRun && <CronjobRunView jobId={openRun.jobId} runId={openRun.runId} username={username} onClose={() => setOpenRun(null)} />}
    </div>
  );
}

function CronjobsTable({
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

  if (cronjobs.length === 0) {
    return <div style={{ padding: 40, textAlign: "center", color: "var(--text-muted)" }}>{loaded ? `No cron jobs yet. Click "+ New" to create one.` : "Loading..."}</div>;
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
