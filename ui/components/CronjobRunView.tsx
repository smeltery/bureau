import { useEffect, useMemo, useRef, useState } from "react";
import { useAppState } from "../store.tsx";
import { LogEntryCard } from "../log-view/entries/index.tsx";
import { send } from "../ws.ts";
import { cronjobRunStreamId, type CronjobRun, type LogEntry } from "../../shared/types.ts";
import { CronjobRunHeader, CronjobRunSummary } from "./cronjob-run-details.tsx";
import { CronjobRunComposer } from "./CronjobRunComposer.tsx";

// Cronjob runs are resumable: any boss can send follow-up turns into a past
// run, and edit-to-fork lets them branch from any prior user message. The
// server-side handlers live in cronjobs/index.ts (sendRunMessage,
// editRunMessage); see send_cronjob_run_message / edit_cronjob_run_message.
export function CronjobRunView({ jobId, runId, username, onClose }: { jobId: string; runId: string; username: string; onClose: () => void }) {
  const { cronjobRunsByJob, isMobile, logs } = useAppState();
  const streamId = cronjobRunStreamId(runId);
  const runs = cronjobRunsByJob.get(jobId) ?? [];
  const run = runs.find((r) => r.id === runId);

  const [input, setInput] = useState("");
  const [editingLogEntryId, setEditingLogEntryId] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [autoScroll, setAutoScroll] = useState(true);

  // Always backfill on open: live entries may have arrived before the user
  // opened the view, but the reducer dedupes by id (defence in depth) so
  // re-requesting on every open is safe.
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    if (loaded) return;
    send({ type: "load_cronjob_run", cronjobId: jobId, runId });
    setLoaded(true);
  }, [jobId, runId, loaded]);

  // ESC closes the view, unless the user is editing a message — then ESC
  // cancels the edit (handled inside EditableUserMessage).
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape" && !editingLogEntryId) {
        e.stopPropagation();
        onClose();
      }
    }
    window.addEventListener("keydown", handleKey, true);
    return () => window.removeEventListener("keydown", handleKey, true);
  }, [onClose, editingLogEntryId]);

  // Sort entries by timestamp: live-then-backfill arrival order is not
  // guaranteed (the reducer appends in arrival order; backfill flushes after
  // any live entries already received). Sorting in the renderer is the cheap
  // way to keep the transcript stable.
  const entries: LogEntry[] = useMemo(() => {
    const arr = (logs.get(streamId) ?? []).slice();
    arr.sort((a, b) => a.timestamp - b.timestamp);
    return arr;
  }, [logs, streamId]);

  const turnData = useMemo(() => {
    type T = { isLastInTurn: boolean; turnEntries: LogEntry[] };
    const map = new Map<string, T>();
    let buf: LogEntry[] = [];
    function flush() {
      if (buf.length === 0) return;
      buf.forEach((e, i) => map.set(e.id, { isLastInTurn: i === buf.length - 1, turnEntries: buf }));
      buf = [];
    }
    for (const e of entries) {
      if (e.kind === "user_message") {
        flush();
        map.set(e.id, { isLastInTurn: false, turnEntries: [] });
      } else {
        buf.push(e);
      }
    }
    flush();
    return map;
  }, [entries]);

  const isRunning = run?.status === "running";
  // Skipped runs never opened a session and runs whose original session never
  // initialized (the placeholder pending-/skipped- ids) can't be resumed.
  const leafSessionId = run?.currentSessionId ?? run?.rootSessionId ?? "";
  const hasResumableSession = !leafSessionId.startsWith("pending-") && !leafSessionId.startsWith("skipped-");
  const canResume = !!run && !isRunning && run.status !== "skipped" && hasResumableSession;

  // Auto-scroll to bottom on new entries when the user hasn't scrolled up.
  useEffect(() => {
    if (!autoScroll || !scrollRef.current) return;
    const el = scrollRef.current;
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        el.scrollTop = el.scrollHeight;
      });
    });
  }, [entries.length, autoScroll]);

  // Cancel any in-progress edit when a run kicks off, so the input box (which
  // is hidden during run) doesn't leave the inline editor stranded.
  useEffect(() => {
    if (isRunning && editingLogEntryId) {
      setEditingLogEntryId(null);
    }
  }, [isRunning, editingLogEntryId]);

  function handleScroll() {
    if (!scrollRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = scrollRef.current;
    setAutoScroll(scrollHeight - scrollTop - clientHeight < 50);
  }

  function autoResize(el: HTMLTextAreaElement) {
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 200) + "px";
  }

  function handleSend() {
    const text = input.trim();
    if (!text || !canResume) return;
    send({ type: "send_cronjob_run_message", cronjobId: jobId, runId, text, username });
    setInput("");
    if (textareaRef.current) textareaRef.current.style.height = "auto";
    setAutoScroll(true);
  }

  function handleSubmitEdit(id: string, newText: string) {
    setEditingLogEntryId(null);
    send({ type: "edit_cronjob_run_message", cronjobId: jobId, runId, logEntryId: id, newText, username });
    setAutoScroll(true);
  }

  return (
    <div
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 950,
        background: "var(--bg-base)",
        display: "flex",
        flexDirection: "column",
      }}
    >
      <CronjobRunHeader run={run} runId={runId} isMobile={isMobile} onClose={onClose} />

      {/* Body */}
      <div ref={scrollRef} onScroll={handleScroll} style={{ flex: 1, overflowY: "auto", padding: isMobile ? "12px" : "16px 24px" }}>
        {run && <CronjobRunSummary run={run} />}
        {entries.length === 0 ? (
          <div style={{ textAlign: "center", color: "var(--text-ghost)", padding: 40 }}>{run?.status === "skipped" ? "This run was skipped." : "No log entries."}</div>
        ) : (
          entries.map((entry) => {
            const td = turnData.get(entry.id);
            const canEditMsg = canResume && entry.kind === "user_message" && !editingLogEntryId;
            return (
              <LogEntryCard
                key={entry.id}
                entry={entry}
                isLastInTurn={td?.isLastInTurn}
                turnEntries={td?.turnEntries}
                isMobile={isMobile}
                canEdit={canEditMsg}
                isEditing={editingLogEntryId === entry.id}
                onStartEdit={setEditingLogEntryId}
                onCancelEdit={() => setEditingLogEntryId(null)}
                onSubmitEdit={handleSubmitEdit}
              />
            );
          })
        )}
        {isRunning && (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              padding: "12px 14px",
              margin: "8px 0",
              color: "var(--green)",
              fontSize: 12,
            }}
          >
            <span style={{ display: "inline-flex", gap: 3 }}>
              <span style={{ width: 4, height: 4, borderRadius: "50%", background: "var(--green)", animation: "dotBounce 1.4s ease-in-out infinite", animationDelay: "0s" }} />
              <span style={{ width: 4, height: 4, borderRadius: "50%", background: "var(--green)", animation: "dotBounce 1.4s ease-in-out infinite", animationDelay: "0.2s" }} />
              <span style={{ width: 4, height: 4, borderRadius: "50%", background: "var(--green)", animation: "dotBounce 1.4s ease-in-out infinite", animationDelay: "0.4s" }} />
            </span>
            <span>Running...</span>
          </div>
        )}
      </div>

      {/* Input — replaces the old read-only banner. Hidden for unresumable runs. */}
      <CronjobRunComposer
        canResume={canResume}
        editingLogEntryId={editingLogEntryId}
        input={input}
        isMobile={isMobile}
        isRunning={isRunning}
        runStatus={run?.status ?? null}
        textareaRef={textareaRef}
        onInputChange={(value, textarea) => {
          setInput(value);
          autoResize(textarea);
        }}
        onSend={handleSend}
      />
    </div>
  );
}
