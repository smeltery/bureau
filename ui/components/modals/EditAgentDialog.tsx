import type { AgentBackendType, AgentInfo } from "../../../shared/types.ts";
import { AgentDialogFrame } from "./AgentDialogFrame.tsx";
import { AgentAppearanceEditor } from "./AgentAppearanceEditor.tsx";
import { AgentModelPermissionFields } from "./AgentModelPermissionFields.tsx";
import { AgentMoveRoomSection } from "./AgentMoveRoomSection.tsx";
import { AgentWorkingDirectoryField } from "./AgentWorkingDirectoryField.tsx";
import { dialogInput, dialogLabel } from "./dialog-styles.ts";
import { ExpandableTextarea } from "./ExpandableTextarea.tsx";
import { useEditAgentDialogController } from "./useEditAgentDialogController.ts";
import { AGENT_TEMPLATES, type AgentTemplate } from "../../agent-templates.ts";

export type EditAgentDialogProps = {
  onClose: () => void;
} & (
  | { agent: AgentInfo; deskIndex?: undefined; room?: undefined; defaultCwd?: undefined; agentType?: undefined }
  | { agent?: undefined; deskIndex: number; room: number; defaultCwd: string; agentType: AgentBackendType }
);

export function EditAgentDialog(props: EditAgentDialogProps) {
  const {
    agent,
    agentMemory,
    agentType,
    applyTemplate,
    agents,
    canTogglePrivileged,
    codexSandbox,
    confirmDiscard,
    customInstructions,
    cwd,
    cwdError,
    handleSave,
    requestClose,
    isMobile,
    isSpawn,
    effort,
    modelFamily,
    modelOptions,
    name,
    outfit,
    permissionMode,
    privileged,
    recentCwds,
    rooms,
    saving,
    setCustomInstructions,
    setCwd,
    setCwdError,
    setCodexSandbox,
    setModelFamily,
    setEffort,
    setName,
    setOutfit,
    setPermissionMode,
    setPrivileged,
    selectedTemplateKey,
    subtitle,
    title,
  } = useEditAgentDialogController(props);

  return (
    <AgentDialogFrame isMobile={isMobile} isSpawn={isSpawn} onClose={requestClose} onSave={handleSave} saving={saving} subtitle={subtitle} title={title}>
      {isSpawn && <AgentTemplatePicker selectedKey={selectedTemplateKey} onPick={applyTemplate} />}

      <label style={labelStyle}>Name</label>
      <input value={name} onChange={(e) => setName(e.target.value)} placeholder={isSpawn ? `Agent ${props.deskIndex! + 1}` : undefined} autoFocus={isSpawn} style={inputStyle} />

      <AgentWorkingDirectoryField
        cwd={cwd}
        cwdError={cwdError}
        inputStyle={inputStyle}
        labelStyle={labelStyle}
        recentCwds={recentCwds}
        setCwd={setCwd}
        setCwdError={setCwdError}
        showNextConversationHint={!isSpawn}
      />

      <AgentModelPermissionFields
        agentType={agentType}
        canTogglePrivileged={canTogglePrivileged}
        inputStyle={inputStyle}
        labelStyle={labelStyle}
        modelFamily={modelFamily}
        modelOptions={modelOptions}
        effort={effort}
        permissionMode={permissionMode}
        codexSandbox={codexSandbox}
        privileged={privileged}
        setModelFamily={setModelFamily}
        setEffort={setEffort}
        setPermissionMode={setPermissionMode}
        setCodexSandbox={setCodexSandbox}
        setPrivileged={setPrivileged}
      />

      <label style={{ ...labelStyle, marginTop: 14 }}>Appearance</label>
      <AgentAppearanceEditor outfit={outfit} onChange={setOutfit} selectStyle={selectStyle} />

      <label style={{ ...labelStyle, marginTop: 14 }}>
        Custom Instructions <span style={{ fontWeight: 400, color: "var(--text-ghost)" }}>(optional)</span>
      </label>
      <ExpandableTextarea
        title="Custom Instructions"
        hint="Personal system prompt for this agent. Run /bureau-system-prompt in a chat to see the agent's full system prompt."
        value={customInstructions}
        onChange={setCustomInstructions}
        placeholder='e.g. "You are a backend specialist. Always write tests."'
        rows={3}
        style={{ ...inputStyle, resize: "vertical" }}
      />
      <p style={{ fontSize: 10, color: "var(--text-ghost)", margin: "3px 0 0" }}>
        Run <code>/bureau-system-prompt</code> in a chat to see the agent's full system prompt.
        {!isSpawn && " Changes take effect on next conversation."}
      </p>

      {!isSpawn && (
        <>
          <label style={{ ...labelStyle, marginTop: 14 }}>
            Memory{" "}
            <span style={{ fontWeight: 400, color: "var(--text-ghost)" }}>
              (durable notes for this agent; {agentMemory.size} / {agentMemory.cap ?? "..."})
            </span>
          </label>
          <ExpandableTextarea
            title="Agent Memory"
            hint="This editor rewrites the file exactly as shown. Use one memory per line; keep existing author/date text unless you mean to change it."
            value={agentMemory.memory}
            onChange={agentMemory.setMemory}
            rows={4}
            style={{ ...inputStyle, resize: "vertical" }}
            disabled={!agentMemory.loaded}
          />
        </>
      )}

      {!isSpawn && <AgentMoveRoomSection agent={agent!} agents={agents} rooms={rooms} labelStyle={labelStyle} confirmDiscard={confirmDiscard} onClose={props.onClose} />}
    </AgentDialogFrame>
  );
}

function AgentTemplatePicker({ selectedKey, onPick }: { selectedKey: string | null; onPick: (template: AgentTemplate | null) => void }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <label style={labelStyle}>Template</label>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
        <button onClick={() => onPick(null)} style={templateButtonStyle(selectedKey === null)} type="button">
          Blank
        </button>
        {AGENT_TEMPLATES.map((template) => (
          <button key={template.key} onClick={() => onPick(template)} title={template.description} style={templateButtonStyle(selectedKey === template.key)} type="button">
            {template.label}
          </button>
        ))}
      </div>
    </div>
  );
}

const labelStyle: React.CSSProperties = dialogLabel;
const inputStyle: React.CSSProperties = dialogInput;

const selectStyle: React.CSSProperties = {
  ...inputStyle,
  appearance: "none",
  cursor: "pointer",
  width: "100%",
};

function templateButtonStyle(selected: boolean): React.CSSProperties {
  return {
    minHeight: 34,
    padding: "7px 9px",
    borderRadius: 8,
    border: selected ? "1px solid var(--accent)" : "1px solid var(--border)",
    background: selected ? "color-mix(in srgb, var(--accent) 16%, var(--bg-input))" : "var(--bg-input)",
    color: "var(--text-primary)",
    fontSize: 11,
    fontWeight: selected ? 700 : 500,
    cursor: "pointer",
    textAlign: "left",
  };
}
