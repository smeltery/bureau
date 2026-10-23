import { useI18n } from "../i18n.tsx";
export function TerminalHeader({
  recordingStatus,
  mobile,
  onClose,
  onInterrupt,
  onRestart,
}: {
  recordingStatus?: import("../../shared/terminal/recordings.ts").RecordingStatus;
  mobile: boolean;
  onClose: () => void;
  onInterrupt?: () => void;
  onRestart?: () => void;
}) {
  const { t } = useI18n();
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "4px 12px",
        minHeight: mobile ? 44 : 36,
        flexWrap: "wrap",
        gap: 6,
        borderBottom: "1px solid var(--border-strong)",
        background: "var(--bg-surface)",
        flexShrink: 0,
      }}
    >
      <span
        style={{
          fontSize: mobile ? 13 : 11,
          color: "var(--text-dim)",
          display: "flex",
          alignItems: "center",
          gap: 6,
        }}
      >
        {!mobile && <span style={{ color: "var(--green)", fontSize: 13 }}>&#9654;</span>}
        {t("terminal.title")}
        {recordingStatus && recordingStatus !== "off" && (
          <span role="status"> · {t(recordingStatus === "recording" ? "terminal.recording" : recordingStatus === "error" ? "terminal.recordingError" : "terminal.recordingStopped")}</span>
        )}
      </span>
      <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
        <button
          onClick={onInterrupt}
          style={{
            padding: "3px 7px",
            borderRadius: 5,
            border: "1px solid var(--border-medium)",
            background: "var(--bg-overlay)",
            color: "var(--text-secondary)",
            fontSize: mobile ? 11 : 10,
            cursor: "pointer",
          }}
          title={t("terminal.interruptHint")}
        >
          {t("terminal.interrupt")}
        </button>
        <button
          onClick={onRestart}
          style={{
            padding: "3px 7px",
            borderRadius: 5,
            border: "1px solid var(--border-medium)",
            background: "var(--bg-overlay)",
            color: "var(--text-secondary)",
            fontSize: mobile ? 11 : 10,
            cursor: "pointer",
          }}
          title={t("terminal.restartHint")}
        >
          {t("terminal.restart")}
        </button>
        <button
          onClick={onClose}
          style={{
            background: "none",
            border: "none",
            color: "var(--text-muted)",
            cursor: "pointer",
            fontSize: mobile ? 24 : 16,
            padding: mobile ? "4px 10px" : "0 4px",
            lineHeight: 1,
          }}
          title={t("terminal.close")}
          aria-label={t("terminal.close")}
        >
          &times;
        </button>
      </div>
    </div>
  );
}

export function TerminalExitOverlay({ exitCode, onRestart }: { exitCode: number; onRestart: () => void }) {
  const { t } = useI18n();
  return (
    <div
      style={{
        position: "absolute",
        bottom: 16,
        left: "50%",
        transform: "translateX(-50%)",
        background: "var(--bg-overlay)",
        border: "1px solid var(--border-medium)",
        borderRadius: 8,
        padding: "8px 16px",
        display: "flex",
        alignItems: "center",
        gap: 12,
        fontSize: 12,
        color: "var(--text-dim)",
        boxShadow: "0 4px 12px var(--shadow)",
      }}
    >
      <span>{t("terminal.exited", { code: exitCode })}</span>
      <button
        onClick={(e) => {
          e.stopPropagation();
          onRestart();
        }}
        style={{
          padding: "3px 12px",
          borderRadius: 6,
          border: "1px solid var(--green-border)",
          background: "var(--green-bg)",
          color: "var(--green)",
          fontSize: 12,
          cursor: "pointer",
        }}
      >
        {t("terminal.restart")}
      </button>
    </div>
  );
}
