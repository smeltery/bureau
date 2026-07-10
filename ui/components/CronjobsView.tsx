import { useEffect, useMemo, useState } from "react";
import { useAppState } from "../store.tsx";
import { send } from "../ws.ts";
import { CronjobDialog } from "./modals/CronjobDialog.tsx";
import { CronjobsPromptDialog } from "./modals/CronjobsPromptDialog.tsx";
import { CronjobRunView } from "./CronjobRunView.tsx";
import { RunsTable } from "./CronjobRunsTable.tsx";
import { CronjobsTable } from "./CronjobsTable.tsx";
import type { Cronjob, CronjobRun } from "../../shared/types.ts";

type Tab = "runs" | "cronjobs";
const TAB_LABEL: Record<Tab, string> = { runs: "runs", cronjobs: "cron jobs" };

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
