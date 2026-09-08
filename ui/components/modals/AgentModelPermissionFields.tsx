import type { CSSProperties } from "react";
import type { AgentBackendType, AgentInfo, CodexSandboxMode, EffortLevel } from "../../../shared/types.ts";
import { effortDisplayLabel, effortLevelsFor, familyAllowsAutoPermission, modelVersionLabel } from "../../../shared/types.ts";

type ModelOption = {
  family: string;
  label: string;
};

type AgentModelPermissionFieldsProps = {
  agentType: AgentBackendType;
  canTogglePrivileged: boolean;
  inputStyle: CSSProperties;
  labelStyle: CSSProperties;
  modelFamily: string;
  modelOptions: ModelOption[];
  effort: EffortLevel;
  permissionMode: AgentInfo["permissionMode"];
  codexSandbox: CodexSandboxMode;
  privileged: boolean;
  setModelFamily: (value: string) => void;
  setEffort: (value: EffortLevel) => void;
  setPermissionMode: (value: AgentInfo["permissionMode"]) => void;
  setCodexSandbox: (value: CodexSandboxMode) => void;
  setPrivileged: (value: boolean) => void;
};

export function AgentModelPermissionFields({
  agentType,
  canTogglePrivileged,
  inputStyle,
  labelStyle,
  modelFamily,
  modelOptions,
  effort,
  permissionMode,
  codexSandbox,
  privileged,
  setModelFamily,
  setEffort,
  setPermissionMode,
  setCodexSandbox,
  setPrivileged,
}: AgentModelPermissionFieldsProps) {
  const effortOptions = effortLevelsFor(agentType, modelFamily);
  return (
    <>
      <label style={{ ...labelStyle, marginTop: 12 }}>Permission Mode</label>
      <select value={permissionMode} onChange={(e) => setPermissionMode(e.target.value as AgentInfo["permissionMode"])} style={{ ...inputStyle, appearance: "none", cursor: "pointer" }}>
        {agentType === "claude" ? (
          <>
            {familyAllowsAutoPermission(modelFamily) && <option value="auto">Auto (classifier auto-approves safe actions)</option>}
            <option value="default">Default (ask for everything)</option>
            <option value="acceptEdits">Accept Edits (auto-approve file changes)</option>
            <option value="bypassPermissions">Bypass (auto-approve all)</option>
          </>
        ) : agentType === "opencode" ? (
          <>
            <option value="default">Ask</option>
            <option value="bypassPermissions">Bypass (auto-approve all)</option>
          </>
        ) : (
          <>
            <option value="never">Never ask</option>
            <option value="on-request">On request</option>
            <option value="untrusted">Untrusted</option>
          </>
        )}
      </select>

      {agentType === "codex" && (
        <>
          <label style={{ ...labelStyle, marginTop: 12 }}>Sandbox</label>
          <select value={codexSandbox} onChange={(e) => setCodexSandbox(e.target.value as CodexSandboxMode)} style={{ ...inputStyle, appearance: "none", cursor: "pointer" }}>
            <option value="danger-full-access">Danger: full access</option>
            <option value="workspace-write">Workspace write</option>
            <option value="read-only">Read only</option>
          </select>
        </>
      )}

      {canTogglePrivileged && (
        <label style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 12, fontSize: 12, color: "var(--text-secondary)", cursor: "pointer" }}>
          <input type="checkbox" checked={privileged} onChange={(e) => setPrivileged(e.target.checked)} style={{ width: 14, height: 14, accentColor: "var(--accent)" }} />
          Privileged operator token
        </label>
      )}

      <label style={{ ...labelStyle, marginTop: 12 }}>Model</label>
      <select
        value={modelFamily}
        onChange={(e) => {
          const next = e.target.value;
          setModelFamily(next);
          if (!familyAllowsAutoPermission(next) && permissionMode === "auto") setPermissionMode("bypassPermissions");
          if (!effortLevelsFor(agentType, next).some((option) => option.level === effort)) setEffort("high");
        }}
        style={{ ...inputStyle, appearance: "none", cursor: "pointer" }}
      >
        {modelOptions.map((m) => (
          <option key={m.family} value={m.family}>
            {agentType === "claude" ? `${m.label} (${modelVersionLabel(m.family as any)})` : m.label}
          </option>
        ))}
      </select>

      <label style={{ ...labelStyle, marginTop: 12 }}>Effort</label>
      <select value={effort} onChange={(e) => setEffort(e.target.value as EffortLevel)} style={{ ...inputStyle, appearance: "none", cursor: "pointer" }}>
        {effortOptions.map((option) => (
          <option key={option.level} value={option.level}>
            {effortDisplayLabel(option.level)}
          </option>
        ))}
      </select>
    </>
  );
}
