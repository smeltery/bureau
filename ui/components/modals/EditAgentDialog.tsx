import type { AgentBackendType, AgentInfo } from "../../../shared/types.ts";
import { AgentDialogFrame } from "./AgentDialogFrame.tsx";
import { AgentAppearanceEditor } from "./AgentAppearanceEditor.tsx";
import { AgentModelPermissionFields } from "./AgentModelPermissionFields.tsx";
import { AgentMoveRoomSection } from "./AgentMoveRoomSection.tsx";
import { AgentWorkingDirectoryField } from "./AgentWorkingDirectoryField.tsx";
import { dialogInput, dialogLabel } from "./dialog-styles.ts";
import { ExpandableTextarea } from "./ExpandableTextarea.tsx";
import { useEditAgentDialogController } from "./useEditAgentDialogController.ts";

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
    agents,
    canTogglePrivileged,
    confirmDiscard,
    customInstructions,
    cwd,
    cwdError,
    handleSave,
    requestClose,
    isMobile,
    isSpawn,
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
    setModelFamily,
    setName,
    setOutfit,
    setPermissionMode,
    setPrivileged,
    subtitle,
    title,
  } = useEditAgentDialogController(props);

  return (
    <AgentDialogFrame isMobile={isMobile} isSpawn={isSpawn} onClose={requestClose} onSave={handleSave} saving={saving} subtitle={subtitle} title={title}>
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
        permissionMode={permissionMode}
        privileged={privileged}
        setModelFamily={setModelFamily}
        setPermissionMode={setPermissionMode}
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

const labelStyle: React.CSSProperties = dialogLabel;
const inputStyle: React.CSSProperties = dialogInput;

const selectStyle: React.CSSProperties = {
  ...inputStyle,
  appearance: "none",
  cursor: "pointer",
  width: "100%",
};
