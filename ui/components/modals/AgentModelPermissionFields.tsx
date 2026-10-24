import type { CSSProperties } from "react";
import type { AgentBackendType, AgentInfo, CodexSandboxMode, EffortLevel } from "../../../shared/types.ts";
import { useI18n } from "../../i18n.tsx";

import { modelEfforts, modelAllowsAuto, modelOptionLabel, type ModelOption } from "../../hooks/models/model-options.ts";

type AgentModelPermissionFieldsProps = {
  agentType: AgentBackendType;
  canTogglePrivileged: boolean;
  inputStyle: CSSProperties;
  labelStyle: CSSProperties;
  modelFamily: string;
  modelOptions: ModelOption[];
  catalogNotice?: string;
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
  catalogNotice,
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
  const { t } = useI18n();
  const effortOptions = modelEfforts(agentType, modelFamily, modelOptions);
  const allowsAuto = modelAllowsAuto(modelFamily, modelOptions);
  return (
    <>
      <label style={{ ...labelStyle, marginTop: 12 }}>{t("dialogs.agent.permissions")}</label>
      <select
        value={permissionMode === "auto" && !allowsAuto ? "default" : permissionMode}
        onChange={(e) => setPermissionMode(e.target.value as AgentInfo["permissionMode"])}
        style={{ ...inputStyle, appearance: "none", cursor: "pointer" }}
      >
        {agentType === "claude" ? (
          <>
            {allowsAuto && <option value="auto">{t("agentSettings.permission.auto")}</option>}
            <option value="default">{t("agentSettings.permission.default")}</option>
            <option value="acceptEdits">{t("agentSettings.permission.edits")}</option>
            <option value="bypassPermissions">{t("agentSettings.permission.bypass")}</option>
          </>
        ) : agentType === "opencode" ? (
          <>
            <option value="default">{t("agentSettings.permission.ask")}</option>
            <option value="bypassPermissions">{t("agentSettings.permission.bypass")}</option>
          </>
        ) : (
          <>
            <option value="never">{t("agentSettings.permission.never")}</option>
            <option value="on-request">{t("agentSettings.permission.request")}</option>
            <option value="untrusted">{t("agentSettings.permission.untrusted")}</option>
          </>
        )}
      </select>

      {agentType === "codex" && (
        <>
          <label style={{ ...labelStyle, marginTop: 12 }}>{t("agentSettings.sandbox")}</label>
          <select value={codexSandbox} onChange={(e) => setCodexSandbox(e.target.value as CodexSandboxMode)} style={{ ...inputStyle, appearance: "none", cursor: "pointer" }}>
            <option value="danger-full-access">{t("agentSettings.sandbox.full")}</option>
            <option value="workspace-write">{t("agentSettings.sandbox.workspace")}</option>
            <option value="read-only">{t("agentSettings.sandbox.read")}</option>
          </select>
        </>
      )}

      {canTogglePrivileged && (
        <label style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 12, fontSize: 12, color: "var(--text-secondary)", cursor: "pointer" }}>
          <input type="checkbox" checked={privileged} onChange={(e) => setPrivileged(e.target.checked)} style={{ width: 14, height: 14, accentColor: "var(--accent)" }} />
          {t("agentSettings.privileged")}
        </label>
      )}

      <label style={{ ...labelStyle, marginTop: 12 }}>{t("dialogs.agent.model")}</label>
      <select
        value={modelFamily}
        onChange={(e) => {
          const next = e.target.value;
          setModelFamily(next);
          if (!modelAllowsAuto(next, modelOptions) && permissionMode === "auto") setPermissionMode("default");
          const levels = modelEfforts(agentType, next, modelOptions);
          if (levels.length && !levels.some((option) => option.level === effort)) setEffort(levels[0]!.level);
        }}
        style={{ ...inputStyle, appearance: "none", cursor: "pointer" }}
      >
        {modelOptions.map((m) => (
          <option key={m.family} value={m.family}>
            {modelOptionLabel(agentType, m)}
          </option>
        ))}
      </select>

      {catalogNotice && (
        <p role="status" style={{ fontSize: 12, color: "var(--text-muted)" }}>
          {catalogNotice}
        </p>
      )}
      {effortOptions.length > 0 && (
        <>
          <label style={{ ...labelStyle, marginTop: 12 }}>{t("dialogs.agent.effort")}</label>
          <select value={effort} onChange={(e) => setEffort(e.target.value as EffortLevel)} style={{ ...inputStyle, appearance: "none", cursor: "pointer" }}>
            {!effortOptions.some((option) => option.level === effort) && (
              <option value={effort} disabled>
                {t("agentSettings.unsupported", { label: t(`logs.effort.${effort}`) })}
              </option>
            )}
            {effortOptions.map((option) => (
              <option key={option.level} value={option.level}>
                {t(`logs.effort.${option.level}`)}
              </option>
            ))}
          </select>
        </>
      )}
    </>
  );
}
