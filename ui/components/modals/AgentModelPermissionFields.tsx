import type { CSSProperties } from "react";
import type { AgentBackendType, AgentInfo } from "../../../shared/types.ts";
import { familyAllowsAutoPermission, modelVersionLabel } from "../../../shared/types.ts";

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
  permissionMode: AgentInfo["permissionMode"];
  privileged: boolean;
  setModelFamily: (value: string) => void;
  setPermissionMode: (value: AgentInfo["permissionMode"]) => void;
  setPrivileged: (value: boolean) => void;
};

export function AgentModelPermissionFields({
  agentType,
  canTogglePrivileged,
  inputStyle,
  labelStyle,
  modelFamily,
  modelOptions,
  permissionMode,
  privileged,
  setModelFamily,
  setPermissionMode,
  setPrivileged,
}: AgentModelPermissionFieldsProps) {
  return (
    <>
      <label style={{ ...labelStyle, marginTop: 12 }}>Permission Mode</label>
      <select value={permissionMode} onChange={(e) => setPermissionMode(e.target.value as AgentInfo["permissionMode"])} style={{ ...inputStyle, appearance: "none", cursor: "pointer" }}>
        {familyAllowsAutoPermission(modelFamily) && <option value="auto">Auto (classifier auto-approves safe actions)</option>}
        <option value="default">Default (ask for everything)</option>
        <option value="acceptEdits">Accept Edits (auto-approve file changes)</option>
        <option value="bypassPermissions">Bypass (auto-approve all)</option>
      </select>

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
        }}
        style={{ ...inputStyle, appearance: "none", cursor: "pointer" }}
      >
        {modelOptions.map((m) => (
          <option key={m.family} value={m.family}>
            {agentType === "claude" ? `${m.label} (${modelVersionLabel(m.family as any)})` : m.label}
          </option>
        ))}
      </select>
    </>
  );
}
