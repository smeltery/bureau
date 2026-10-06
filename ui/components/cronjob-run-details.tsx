import type { CronjobRun } from "../../shared/types.ts";
import { shortenCwd } from "../cwd-display.ts";

const STATUS_LABEL: Record<CronjobRun["status"], string> = {
  running: "Running",
  completed: "Completed",
  failed: "Failed",
  timed_out: "Timed out",
  skipped: "Skipped",
};

const STATUS_COLOR: Record<CronjobRun["status"], string> = {
  running: "var(--green)",
  completed: "var(--text-secondary)",
  failed: "var(--red)",
  timed_out: "var(--orange, #d29922)",
  skipped: "var(--text-muted)",
};

export function CronjobRunHeader({ run, runId, isMobile, onClose }: { run: CronjobRun | undefined; runId: string; isMobile: boolean; onClose: () => void }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        padding: isMobile ? "0 8px" : "0 20px",
        paddingTop: isMobile ? "env(safe-area-inset-top, 0px)" : undefined,
        minHeight: 48,
        background: "var(--bg-surface)",
        borderBottom: "1px solid var(--border-strong)",
        flexShrink: 0,
      }}
    >
      <button
        onClick={onClose}
        style={{
          background: "none",
          border: "none",
          color: "var(--text-muted)",
          fontSize: 18,
          cursor: "pointer",
          padding: "2px 8px",
          flexShrink: 0,
        }}
      >
        &larr;
      </button>
      {run ? <RunTitle run={run} isMobile={isMobile} /> : <span style={{ fontSize: 14, fontWeight: 700, color: "var(--text-primary)" }}>Run #{runId}</span>}
    </div>
  );
}

function RunTitle({ run, isMobile }: { run: CronjobRun; isMobile: boolean }) {
  const timestamp = new Date(run.startedAt).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
  const trigger =
    run.trigger === "manual"
      ? `manual${run.triggeredBy ? ` \u00b7 ${run.triggeredBy}` : ""}`
      : run.trigger === "webhook"
        ? `webhook · ${run.webhook?.deliveryId ?? run.triggeredBy ?? ""}`
        : "scheduled";
  if (isMobile) {
    return (
      <div style={{ display: "flex", flexDirection: "column", flex: 1, minWidth: 0, padding: "6px 0", gap: 2 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
          <span style={{ fontSize: 14, fontWeight: 700, color: "var(--text-primary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{run.cronjobName}</span>
          <span style={{ fontSize: 11, color: STATUS_COLOR[run.status], fontFamily: "'JetBrains Mono',monospace", fontWeight: 600, flexShrink: 0 }}>{STATUS_LABEL[run.status]}</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 11, color: "var(--text-muted)", fontFamily: "'JetBrains Mono',monospace" }}>
          <span>{timestamp}</span>
          <span style={{ color: "var(--text-ghost)" }}>{trigger}</span>
        </div>
      </div>
    );
  }
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
      <span style={{ fontSize: 14, fontWeight: 700, color: "var(--text-primary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{run.cronjobName}</span>
      <span style={{ fontSize: 11, color: STATUS_COLOR[run.status], fontFamily: "'JetBrains Mono',monospace", fontWeight: 600 }}>{STATUS_LABEL[run.status]}</span>
      <span style={{ fontSize: 11, color: "var(--text-muted)", fontFamily: "'JetBrains Mono',monospace" }}>{timestamp}</span>
      <span style={{ fontSize: 11, color: "var(--text-ghost)", fontFamily: "'JetBrains Mono',monospace" }}>{trigger}</span>
    </div>
  );
}

export function CronjobRunSummary({ run }: { run: CronjobRun }) {
  return (
    <div
      style={{
        padding: "10px 14px",
        marginBottom: 12,
        borderRadius: 8,
        background: "var(--bg-surface)",
        border: "1px solid var(--border-subtle)",
        fontSize: 12,
        color: "var(--text-secondary)",
        fontFamily: "'JetBrains Mono',monospace",
      }}
    >
      <div style={{ fontSize: 10, color: "var(--text-muted)", marginBottom: 4 }}>PROMPT</div>
      <div style={{ whiteSpace: "pre-wrap" }}>{run.promptSnapshot}</div>
      <div style={{ marginTop: 8, fontSize: 10, color: "var(--text-ghost)" }}>
        cwd: {shortenCwd(run.cwdSnapshot)} {"\u00b7"} backend: {run.agentTypeSnapshot} {"\u00b7"} model: {run.modelFamilySnapshot} {"\u00b7"} effort: {run.effortSnapshot} {"\u00b7"} permission:{" "}
        {run.permissionModeSnapshot}
        {run.codexSandboxSnapshot ? ` \u00b7 sandbox: ${run.codexSandboxSnapshot}` : ""}
      </div>
      {run.errorReason && <div style={{ marginTop: 8, fontSize: 11, color: "var(--red)" }}>Error: {run.errorReason}</div>}
    </div>
  );
}
