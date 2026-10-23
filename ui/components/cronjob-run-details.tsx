import { useI18n } from "../i18n.tsx";
import { runStartedAt, runTrigger } from "./schedules/format.ts";
import type { CronjobRun } from "../../shared/types.ts";
import { shortenCwd } from "../cwd-display.ts";

const STATUS_COLOR: Record<CronjobRun["status"], string> = {
  running: "var(--green)",
  completed: "var(--text-secondary)",
  failed: "var(--red)",
  timed_out: "var(--orange, #d29922)",
  skipped: "var(--text-muted)",
};

export function CronjobRunHeader({ run, runId, isMobile, onClose }: { run: CronjobRun | undefined; runId: string; isMobile: boolean; onClose: () => void }) {
  const { t } = useI18n();
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
      {run ? <RunTitle run={run} isMobile={isMobile} /> : <span style={{ fontSize: 14, fontWeight: 700, color: "var(--text-primary)" }}>{t("schedules.runTitle", { id: runId })}</span>}
    </div>
  );
}

function RunTitle({ run, isMobile }: { run: CronjobRun; isMobile: boolean }) {
  const { t, language } = useI18n();
  const timestamp = runStartedAt(run.startedAt, language, true);
  const trigger = runTrigger(run, language);
  if (isMobile) {
    return (
      <div style={{ display: "flex", flexDirection: "column", flex: 1, minWidth: 0, padding: "6px 0", gap: 2 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
          <span style={{ fontSize: 14, fontWeight: 700, color: "var(--text-primary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{run.cronjobName}</span>
          <span style={{ fontSize: 11, color: STATUS_COLOR[run.status], fontFamily: "'JetBrains Mono',monospace", fontWeight: 600, flexShrink: 0 }}>
            {t(`schedules.status.${run.status === "timed_out" ? "timedOut" : run.status}`)}
          </span>
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
      <span style={{ fontSize: 11, color: STATUS_COLOR[run.status], fontFamily: "'JetBrains Mono',monospace", fontWeight: 600 }}>
        {t(`schedules.status.${run.status === "timed_out" ? "timedOut" : run.status}`)}
      </span>
      <span style={{ fontSize: 11, color: "var(--text-muted)", fontFamily: "'JetBrains Mono',monospace" }}>{timestamp}</span>
      <span style={{ fontSize: 11, color: "var(--text-ghost)", fontFamily: "'JetBrains Mono',monospace" }}>{trigger}</span>
    </div>
  );
}

export function CronjobRunSummary({ run }: { run: CronjobRun }) {
  const { t } = useI18n();
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
      <div style={{ fontSize: 10, color: "var(--text-muted)", marginBottom: 4 }}>{t("schedules.prompt")}</div>
      <div style={{ whiteSpace: "pre-wrap" }}>{run.promptSnapshot}</div>
      <div style={{ marginTop: 8, fontSize: 10, color: "var(--text-ghost)" }}>
        {t("schedules.cwd")}: {shortenCwd(run.cwdSnapshot)} {"\u00b7"} {t("schedules.backend")}: {run.agentTypeSnapshot} {"\u00b7"} {t("schedules.model")}: {run.modelFamilySnapshot} {"\u00b7"}{" "}
        {t("schedules.effort")}: {run.effortSnapshot} {"\u00b7"} {t("schedules.permission")}: {run.permissionModeSnapshot}
        {run.codexSandboxSnapshot ? ` · ${t("schedules.sandbox")}: ${run.codexSandboxSnapshot}` : ""}
      </div>
      {run.errorReason && <div style={{ marginTop: 8, fontSize: 11, color: "var(--red)" }}>{t("schedules.error", { error: run.errorReason })}</div>}
    </div>
  );
}
