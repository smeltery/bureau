import { useAppState } from "../../store.tsx";
import { modelVersionLabel, type AgentBackendType, type CodexSandboxMode, type Cronjob, type CronjobPermissionMode, type EffortLevel, type ModelFamily } from "../../../shared/types.ts";
import { dialogCancelBtn, dialogChip, dialogInput, dialogLabel, dialogSaveBtn } from "./dialog-styles.ts";
import { CronjobScheduleFields } from "./CronjobScheduleFields.tsx";
import { ExpandableTextarea } from "./ExpandableTextarea.tsx";
import { useCronjobDialogState } from "./useCronjobDialogState.ts";
import { shortenCwd } from "../../cwd-display.ts";

export function CronjobDialog({ cronjob, username, onClose }: { cronjob?: Cronjob; username: string; onClose: () => void }) {
  const { recentCwds, isMobile } = useAppState();
  const {
    agentType,
    codexSandbox,
    confirmDelete,
    cwd,
    effort,
    effortOptions,
    enabled,
    error,
    handleDelete,
    handleSave,
    hourStr,
    intervalStr,
    isEdit,
    minuteStr,
    modelFamily,
    modelOptions,
    name,
    permissionMode,
    prompt,
    saving,
    scheduleType,
    selectAgentType,
    selectModelFamily,
    setCodexSandbox,
    setConfirmDelete,
    setCwd,
    setEffort,
    setEnabled,
    setHourStr,
    setIntervalStr,
    setMinuteStr,
    setName,
    setPermissionMode,
    setPrompt,
    setScheduleType,
    setWeekday,
    weekday,
  } = useCronjobDialogState({ cronjob, username, onClose });
  const recentCwdsFiltered = recentCwds.filter((c) => c !== cwd);

  return (
    <div
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 900,
        background: "rgba(0,0,0,0.55)",
        backdropFilter: "blur(10px)",
        display: "flex",
        alignItems: isMobile ? "stretch" : "center",
        justifyContent: "center",
        overflowY: "auto",
      }}
    >
      <div
        style={{
          background: "var(--bg-overlay)",
          backdropFilter: "blur(16px)",
          border: isMobile ? "none" : "1px solid var(--border-light)",
          borderRadius: isMobile ? 0 : 16,
          display: "flex",
          flexDirection: "column",
          width: isMobile ? "100%" : 460,
          height: isMobile ? "100dvh" : undefined,
          maxHeight: isMobile ? "100dvh" : "90vh",
          boxShadow: isMobile ? "none" : "0 20px 60px var(--shadow-heavy)",
          animation: "hudIn 0.2s ease-out",
        }}
      >
        <div style={{ overflowY: "auto", flex: 1, padding: isMobile ? "max(24px, env(safe-area-inset-top)) 20px 0" : "24px 28px 0" }}>
          <h3 style={{ fontSize: 17, fontWeight: 700, margin: 0, color: "var(--text-primary)" }}>{isEdit ? "Edit Cron Job" : "New Cron Job"}</h3>
          {isEdit && <p style={{ fontSize: 11, color: "var(--text-faint)", margin: "2px 0 18px", fontFamily: "'JetBrains Mono',monospace" }}>#{cronjob!.id}</p>}

          <label style={labelStyle}>Name</label>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Daily summary" autoFocus={!isEdit} style={inputStyle} />

          <CronjobScheduleFields
            scheduleType={scheduleType}
            setScheduleType={setScheduleType}
            weekday={weekday}
            setWeekday={setWeekday}
            hourStr={hourStr}
            setHourStr={setHourStr}
            minuteStr={minuteStr}
            setMinuteStr={setMinuteStr}
            intervalStr={intervalStr}
            setIntervalStr={setIntervalStr}
            labelStyle={labelStyle}
            inputStyle={inputStyle}
          />

          <label style={{ ...labelStyle, marginTop: 14 }}>Prompt</label>
          <ExpandableTextarea
            title={isEdit ? `${name || "Cron Job"} · Prompt` : "Cron Job Prompt"}
            hint="Sent to the agent at every scheduled run."
            value={prompt}
            onChange={setPrompt}
            placeholder='e.g. "Summarize what every agent accomplished yesterday."'
            rows={4}
            style={{ ...inputStyle, resize: "vertical" }}
          />

          <label style={{ ...labelStyle, marginTop: 14 }}>Working Directory</label>
          <input value={cwd} onChange={(e) => setCwd(e.target.value)} style={inputStyle} />
          {recentCwdsFiltered.length > 0 && (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginTop: 6 }}>
              {recentCwdsFiltered.map((c) => (
                <button key={c} onClick={() => setCwd(c)} style={chipStyle}>
                  {shortenCwd(c)}
                </button>
              ))}
            </div>
          )}

          <label style={{ ...labelStyle, marginTop: 14 }}>Backend</label>
          <select
            value={agentType}
            onChange={(e) => selectAgentType(e.target.value as AgentBackendType)}
            disabled={isEdit}
            style={{ ...inputStyle, appearance: "none", cursor: isEdit ? "default" : "pointer", opacity: isEdit ? 0.85 : 1 }}
          >
            <option value="claude">Claude</option>
            <option value="codex">Codex</option>
          </select>

          <label style={{ ...labelStyle, marginTop: 14 }}>Model</label>
          <select value={modelFamily} onChange={(e) => selectModelFamily(e.target.value)} style={{ ...inputStyle, appearance: "none", cursor: "pointer" }}>
            {modelOptions.map((m) => (
              <option key={m.family} value={m.family}>
                {agentType === "claude" ? `${m.label} (${modelVersionLabel(m.family as ModelFamily)})` : m.label}
              </option>
            ))}
          </select>

          <label style={{ ...labelStyle, marginTop: 14 }}>Effort</label>
          <select value={effort} onChange={(e) => setEffort(e.target.value as EffortLevel)} style={{ ...inputStyle, appearance: "none", cursor: "pointer" }}>
            {effortOptions.map((e) => (
              <option key={e.level} value={e.level}>
                {e.label}
              </option>
            ))}
          </select>

          {agentType === "codex" && (
            <>
              <label style={{ ...labelStyle, marginTop: 14 }}>Sandbox</label>
              <select value={codexSandbox} onChange={(e) => setCodexSandbox(e.target.value as CodexSandboxMode)} style={{ ...inputStyle, appearance: "none", cursor: "pointer" }}>
                <option value="workspace-write">Workspace write</option>
                <option value="read-only">Read only</option>
                <option value="danger-full-access">Danger full access</option>
              </select>
            </>
          )}

          <label style={{ ...labelStyle, marginTop: 14 }}>Permission Mode</label>
          <select value={permissionMode} onChange={(e) => setPermissionMode(e.target.value as CronjobPermissionMode)} style={{ ...inputStyle, appearance: "none", cursor: "pointer" }}>
            {agentType === "claude" ? <option value="bypassPermissions">Bypass (auto-approve all)</option> : <option value="never">Never ask (unattended)</option>}
          </select>
          <p style={{ fontSize: 10, color: "var(--text-ghost)", margin: "3px 0 0" }}>Cron jobs run unattended — modes that require human approval are not available.</p>

          {isEdit && (
            <div style={{ marginTop: 14, display: "flex", alignItems: "center", gap: 8 }}>
              <input type="checkbox" id="cronjob-enabled" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} style={{ width: 16, height: 16, cursor: "pointer" }} />
              <label htmlFor="cronjob-enabled" style={{ fontSize: 12, color: "var(--text-secondary)", cursor: "pointer" }}>
                Enabled (uncheck to pause without deleting)
              </label>
            </div>
          )}

          {error && <p style={{ fontSize: 11, color: "#ff6b6b", margin: "10px 0 0" }}>{error}</p>}
        </div>

        <div
          style={{
            display: "flex",
            justifyContent: isEdit ? "space-between" : "flex-end",
            gap: 8,
            padding: isMobile ? "16px 20px max(16px, env(safe-area-inset-bottom))" : "16px 28px",
            borderTop: "1px solid var(--border)",
            flexShrink: 0,
          }}
        >
          {isEdit && (
            <button
              onClick={handleDelete}
              onBlur={() => setConfirmDelete(false)}
              style={{
                padding: "7px 16px",
                borderRadius: 8,
                border: `1px solid ${confirmDelete ? "var(--red)" : "var(--border)"}`,
                background: confirmDelete ? "var(--red)" : "transparent",
                color: confirmDelete ? "var(--bg-base)" : "var(--red)",
                fontSize: 12,
                fontWeight: 600,
                cursor: "pointer",
              }}
              disabled={saving}
            >
              {confirmDelete ? "Confirm?" : "Delete"}
            </button>
          )}
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={onClose} style={cancelBtnStyle} disabled={saving}>
              Cancel
            </button>
            <button onClick={handleSave} style={saveBtnStyle} disabled={saving}>
              {saving ? "Saving…" : isEdit ? "Save" : "Create"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

const labelStyle: React.CSSProperties = dialogLabel;
const inputStyle: React.CSSProperties = dialogInput;
const chipStyle: React.CSSProperties = dialogChip;
const cancelBtnStyle: React.CSSProperties = dialogCancelBtn;
const saveBtnStyle: React.CSSProperties = dialogSaveBtn;
