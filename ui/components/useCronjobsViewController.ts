import { useEffect, useMemo, useState } from "react";
import type { Cronjob, CronjobRun } from "../../shared/types.ts";
import { useAppState } from "../store.tsx";
import { send } from "../ws.ts";
import { shouldHostCloseOnEscape } from "./modals/expandedEditorState.ts";

export type CronjobsViewTab = "runs" | "cronjobs";

export function useCronjobsViewController() {
  const { cronjobs, cronjobsLoaded, cronjobRunsByJob, cronjobRunsLoaded, isMobile } = useAppState();
  const [tab, setTab] = useState<CronjobsViewTab>("runs");
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
  //
  // This listener is registered before the cron dialogs it renders, so it also
  // runs before an expanded editor (ExpandableTextarea) inside one of them.
  // Standing down matters here: dismissing `editing`/`creating` unmounts the
  // whole cron job form and drops every unsaved field with it, when all the
  // user asked for was to collapse the fullscreen prompt editor.
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (shouldHostCloseOnEscape(e)) {
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

  return {
    creating,
    cronjobRunsByJob,
    cronjobRunsLoaded,
    cronjobs,
    cronjobsLoaded,
    editing,
    editingPrompt,
    filteredRuns,
    isMobile,
    openRun,
    runFilter,
    setCreating,
    setEditing,
    setEditingPrompt,
    setOpenRun,
    setRunFilter,
    setTab,
    tab,
  };
}
