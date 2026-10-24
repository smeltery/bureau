import { MemoryLoadFeedback } from "./settings/MemoryLoadFeedback.tsx";
import { HandoffFields } from "./agent-form/HandoffFields.tsx";
import { useEffect, useRef, useState } from "react";
import type { AgentBackendType, AgentInfo, KilledAgentSummary } from "../../../shared/types.ts";
import { AgentDialogFrame } from "./AgentDialogFrame.tsx";
import { AgentAppearanceEditor } from "./AgentAppearanceEditor.tsx";
import { AgentModelPermissionFields } from "./AgentModelPermissionFields.tsx";
import { AgentMoveRoomSection } from "./AgentMoveRoomSection.tsx";
import { AgentWorkingDirectoryField } from "./AgentWorkingDirectoryField.tsx";
import { dialogInput, dialogLabel } from "./dialog-styles.ts";
import { ExpandableTextarea } from "./ExpandableTextarea.tsx";
import { EditAgentManagerField } from "./EditAgentManagerField.tsx";
import { useEditAgentDialogController } from "./useEditAgentDialogController.ts";
import { AGENT_TEMPLATES, templateDescription, templateLabel, type AgentTemplate } from "../../agent-templates.ts";
import { ENGINE_ACCENT, ENGINE_OPTIONS } from "./engine-options.ts";
import { useAppState } from "../../store.tsx";
import { addRawListener, removeRawListener, send } from "../../ws.ts";
import { useI18n } from "../../i18n.tsx";
import type { PlainMessageKey } from "../../../shared/i18n/translate.ts";

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
    canEditManager,
    codexSandbox,
    confirmDiscard,
    customInstructions,
    autoHandoff,
    autoHandoffTokens,
    setAutoHandoffTokens,
    setAutoHandoff,
    resumeAfterUsageLimit,
    setResumeAfterUsageLimit,
    cwd,
    cwdError,
    handleSave,
    requestClose,
    isMobile,
    isSpawn,
    effort,
    modelFamily,
    modelOptions,
    modelCatalogError,
    managerOptions,
    managerUserId,
    name,
    outfit,
    permissionMode,
    privileged,
    recentCwds,
    rooms,
    saving,
    setAgentType,
    setCustomInstructions,
    setCwd,
    setCwdError,
    setCodexSandbox,
    setManagerUserId,
    setModelFamily,
    setEffort,
    setName,
    setOutfit,
    setPermissionMode,
    setPrivileged,
    selectedTemplateKey,
    subtitle,
    title,
    instructionsStale,
  } = useEditAgentDialogController(props);
  const killedAgents = useAppState().killedAgents;
  const { t, rich, language } = useI18n();
  const engineLabelKey: Record<"claude" | "codex" | "opencode", PlainMessageKey> = {
    claude: "dialogs.agent.engine.claude",
    codex: "dialogs.agent.engine.codex",
    opencode: "dialogs.agent.engine.opencode",
  };
  const engineBlurbKey: Record<"claude" | "codex" | "opencode", PlainMessageKey> = {
    claude: "dialogs.agent.engineBlurb.claude",
    codex: "dialogs.agent.engineBlurb.codex",
    opencode: "dialogs.agent.engineBlurb.opencode",
  };

  return (
    <AgentDialogFrame isMobile={isMobile} isSpawn={isSpawn} onClose={requestClose} onSave={handleSave} saving={saving} subtitle={subtitle} title={title}>
      {isSpawn && <AgentTemplatePicker selectedKey={selectedTemplateKey} onPick={applyTemplate} />}

      <div style={{ marginBottom: 14 }}>
        <label style={labelStyle}>{t("dialogs.agent.engine")}</label>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
          {ENGINE_OPTIONS.map((option) => (
            <button key={option.agentType} onClick={() => setAgentType(option.agentType)} style={engineButtonStyle(agentType === option.agentType, option.accent)} type="button">
              <span style={{ display: "block", fontSize: 13, fontWeight: 700 }}>{t(engineLabelKey[option.agentType])}</span>
              <span style={{ display: "block", marginTop: 2, fontSize: 11, lineHeight: 1.35, color: "var(--text-muted)" }}>{t(engineBlurbKey[option.agentType])}</span>
            </button>
          ))}
        </div>
      </div>

      <label style={labelStyle}>{t("common.name")}</label>
      <input value={name} onChange={(e) => setName(e.target.value)} placeholder={isSpawn ? t("dialogs.agent.namePlaceholder", { number: props.deskIndex! + 1 }) : undefined} style={inputStyle} />

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
        catalogNotice={modelCatalogError}
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

      <label style={{ ...labelStyle, marginTop: 14 }}>{t("dialogs.agent.appearance")}</label>
      <AgentAppearanceEditor outfit={outfit} onChange={setOutfit} selectStyle={selectStyle} />

      {!isSpawn && <EditAgentManagerField canEditManager={canEditManager} managerUserId={managerUserId} managerOptions={managerOptions} setManagerUserId={setManagerUserId} />}

      {!isSpawn && (agentType === "claude" || agentType === "codex") && (
        <label style={{ ...labelStyle, display: "block", marginTop: 14 }}>
          <input type="checkbox" checked={resumeAfterUsageLimit} onChange={(event) => setResumeAfterUsageLimit(event.target.checked)} /> {t("agentSettings.resume")}
          <span style={{ display: "block", fontWeight: 400 }}>
            {t("agentSettings.resumeHint")} {agent?.usageResumeAt ? t("agentSettings.resumeAt", { date: new Date(agent.usageResumeAt).toLocaleString(language) }) : ""}
          </span>
        </label>
      )}
      <HandoffFields labelStyle={labelStyle} inputStyle={inputStyle} enabled={autoHandoff} tokens={autoHandoffTokens} onEnabled={setAutoHandoff} onTokens={setAutoHandoffTokens} />
      <label style={{ ...labelStyle, marginTop: 14 }}>
        {t("dialogs.agent.customInstructions")} <span style={{ fontWeight: 400, color: "var(--text-ghost)" }}>{t("common.optional")}</span>
      </label>
      <ExpandableTextarea
        title={t("dialogs.agent.customInstructions")}
        hint={t("agentSettings.instructionsHint")}
        value={customInstructions}
        onChange={setCustomInstructions}
        placeholder={t("agentSettings.instructionsExample")}
        rows={3}
        style={{ ...inputStyle, resize: "vertical" }}
      />
      <p style={{ fontSize: 10, color: "var(--text-ghost)", margin: "3px 0 0" }}>
        {rich("agentSettings.instructionsCommand", { command: <code>/bureau-system-prompt</code> })} {!isSpawn && t("agentSettings.nextConversation")}
      </p>
      {!isSpawn && instructionsStale && <p style={{ fontSize: 11, color: "var(--orange)", margin: "6px 0 0" }}>{t("agentSettings.instructionsStale")}</p>}

      {isSpawn && props.room !== undefined && killedAgents.length > 0 && (
        <ReviveAgentSection deskIndex={props.deskIndex} roomId={rooms[props.room]?.id} killedAgents={killedAgents} onRevived={props.onClose} />
      )}

      {!isSpawn && (
        <>
          <label style={{ ...labelStyle, marginTop: 14 }}>
            {t("agentSettings.memory")}{" "}
            <span style={{ fontWeight: 400, color: "var(--text-ghost)" }}>
              {t("agentSettings.memorySize", { size: agentMemory.size.toLocaleString(language), cap: agentMemory.cap?.toLocaleString(language) ?? "…" })}
            </span>
          </label>
          <ExpandableTextarea
            title={t("agentSettings.memoryTitle")}
            hint={t("agentSettings.memoryHint")}
            value={agentMemory.memory}
            onChange={agentMemory.setMemory}
            rows={4}
            style={{ ...inputStyle, resize: "vertical" }}
            disabled={!agentMemory.loaded}
          />
          <MemoryLoadFeedback editor={agentMemory} title={t("agentSettings.memoryTitle")} />
        </>
      )}

      {!isSpawn && <AgentMoveRoomSection agent={agent!} agents={agents} rooms={rooms} labelStyle={labelStyle} confirmDiscard={confirmDiscard} onClose={props.onClose} />}
    </AgentDialogFrame>
  );
}

function ReviveAgentSection({ deskIndex, roomId, killedAgents, onRevived }: { deskIndex: number; roomId: string | undefined; killedAgents: KilledAgentSummary[]; onRevived: () => void }) {
  const { t } = useI18n();
  const [reviving, setReviving] = useState<string | null>(null);
  const [error, setError] = useState<{ detail?: string } | null>(null);
  const pendingListener = useRef<((data: string) => void) | null>(null);

  useEffect(() => {
    return () => {
      if (pendingListener.current) removeRawListener(pendingListener.current);
    };
  }, []);

  function handleRevive(agent: KilledAgentSummary) {
    if (reviving || !roomId) return;
    setError(null);
    setReviving(agent.id);
    const requestId = `revive-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const listener = (data: string) => {
      try {
        const msg = JSON.parse(data);
        if (msg.type !== "agent_save_response" || msg.requestId !== requestId) return;
        removeRawListener(listener);
        pendingListener.current = null;
        setReviving(null);
        if (msg.ok) onRevived();
        else setError({ detail: msg.error || undefined });
      } catch {}
    };
    addRawListener(listener);
    pendingListener.current = listener;
    send({ type: "revive", requestId, agentId: agent.id, desk: deskIndex, roomId });
  }

  return (
    <div style={{ marginTop: 16, paddingBottom: 8 }}>
      <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.5, color: "var(--text-dim)", marginBottom: 8 }}>{t("agentSettings.revive")}</div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
        {killedAgents.map((agent) => {
          const accent = ENGINE_ACCENT[agent.agentType];
          const isThisReviving = reviving === agent.id;
          const disabled = reviving !== null && !isThisReviving;
          const title = agent.topic ? `${agent.lastRoomName} - ${agent.topic}` : agent.lastRoomName;
          return (
            <button key={agent.id} onClick={() => handleRevive(agent)} disabled={disabled} title={title} style={reviveButtonStyle(accent, disabled)} type="button">
              <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{isThisReviving ? t("agentSettings.reviving") : agent.name}</span>
            </button>
          );
        })}
      </div>
      {error && <div style={{ marginTop: 8, fontSize: 12, color: "var(--accent-error, #f88)" }}>{error.detail ?? t("agentSettings.reviveFailed")}</div>}
    </div>
  );
}

function AgentTemplatePicker({ selectedKey, onPick }: { selectedKey: string | null; onPick: (template: AgentTemplate | null) => void }) {
  const { language, t } = useI18n();
  return (
    <div style={{ marginBottom: 14 }}>
      <label style={labelStyle}>{t("dialogs.agent.template")}</label>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
        <button autoFocus data-spawn-initial-focus="template" onClick={() => onPick(null)} style={templateButtonStyle(selectedKey === null)} type="button">
          {t("dialogs.agent.blank")}
        </button>
        {AGENT_TEMPLATES.map((template) => (
          <button key={template.key} onClick={() => onPick(template)} title={templateDescription(template, language)} style={templateButtonStyle(selectedKey === template.key)} type="button">
            {templateLabel(template, language)}
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

function engineButtonStyle(selected: boolean, accent: string): React.CSSProperties {
  return {
    minHeight: 58,
    padding: "8px 10px",
    borderRadius: 8,
    border: selected ? `2px solid ${accent}` : "1px solid var(--border)",
    background: selected ? "color-mix(in srgb, var(--accent) 12%, var(--bg-input))" : "var(--bg-input)",
    color: "var(--text-primary)",
    cursor: "pointer",
    textAlign: "left",
  };
}

function reviveButtonStyle(accent: string, disabled: boolean): React.CSSProperties {
  return {
    background: "var(--bg-surface)",
    border: `1.5px solid ${accent}`,
    borderRadius: 999,
    padding: "5px 10px",
    fontSize: 12,
    color: "var(--text-primary)",
    cursor: disabled ? "not-allowed" : "pointer",
    opacity: disabled ? 0.4 : 1,
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    maxWidth: "100%",
  };
}
