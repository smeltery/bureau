import { useEffect, useRef, useState } from "react";
import type { AgentBackendType, AgentInfo, AgentOutfit, ClientCommand, CodexSandboxMode, EffortLevel } from "../../../shared/types.ts";
import { CODEX_MODELS, DEFAULT_EFFORT, familyAllowsAutoPermission, MODEL_FAMILIES, OPENCODE_MODELS } from "../../../shared/types.ts";
import { templateFormValues, type AgentTemplate } from "../../agent-templates.ts";
import { useMemoryEditor } from "../../hooks/useMemoryEditor.ts";
import { useAppState } from "../../store.tsx";
import { addRawListener, removeRawListener, send } from "../../ws.ts";
import { makeRandomOutfit } from "./AgentAppearanceEditor.tsx";
import type { EditAgentDialogProps } from "./EditAgentDialog.tsx";
import { useI18n } from "../../i18n.tsx";
import { applySpawnEngineDefaults } from "./spawn-engine-defaults.ts";

export function canToggleAgentPrivilege(isSpawn: boolean, sessionContext: { role: "owner" | "member"; userId: string } | null, agent: Pick<AgentInfo, "userId"> | undefined): boolean {
  return !isSpawn && (sessionContext?.role === "owner" || (sessionContext?.userId != null && agent?.userId === sessionContext.userId));
}

// Everything the form can edit, flattened to comparable primitives (outfit as
// JSON). Dirtiness is measured against the RENDERED opening state — the random
// spawn outfit and the auto-corrected permission mode count as the baseline,
// not the persisted agent — so only the user's own edits make the form dirty.
export type EditAgentFormSnapshot = {
  name: string;
  cwd: string;
  outfit: string;
  customInstructions: string;
  modelFamily: string;
  agentType: AgentBackendType;
  permissionMode: string;
  codexSandbox: CodexSandboxMode;
  effort: EffortLevel;
  privileged: boolean;
};

export function isFormDirty(baseline: EditAgentFormSnapshot, current: EditAgentFormSnapshot): boolean {
  return (
    baseline.name !== current.name ||
    baseline.cwd !== current.cwd ||
    baseline.outfit !== current.outfit ||
    baseline.customInstructions !== current.customInstructions ||
    baseline.modelFamily !== current.modelFamily ||
    baseline.agentType !== current.agentType ||
    baseline.permissionMode !== current.permissionMode ||
    baseline.codexSandbox !== current.codexSandbox ||
    baseline.effort !== current.effort ||
    baseline.privileged !== current.privileged
  );
}

export function useEditAgentDialogController(props: EditAgentDialogProps) {
  const { onClose } = props;
  const isSpawn = !props.agent;
  const agent = props.agent;
  const initialAgentType = agent?.agentType ?? props.agentType ?? "claude";
  const [agentType, setAgentType] = useState<AgentBackendType>(initialAgentType);

  const { recentCwds: allRecentCwds, isMobile, agents, rooms, sessionContext } = useAppState();
  const { t } = useI18n();
  const roomCount = rooms.length;
  const [name, setName] = useState(agent?.name ?? "");
  const [cwd, setCwd] = useState(agent?.cwd ?? props.defaultCwd ?? "~");
  const [outfit, setOutfit] = useState<AgentOutfit>(agent ? { ...agent.outfit } : makeRandomOutfit);
  const [customInstructions, setCustomInstructions] = useState(agent?.customInstructions ?? "");
  const instructionsVersionAtOpen = useRef(agent?.customInstructionsVersion ?? "");
  const instructionsStale = !isSpawn && !!agent && agent.customInstructionsVersion !== instructionsVersionAtOpen.current;
  const modelOptions =
    agentType === "codex"
      ? CODEX_MODELS.map((m) => ({ family: m.value, label: m.label }))
      : agentType === "opencode"
        ? OPENCODE_MODELS.map((m) => ({ family: m.value, label: m.label }))
        : MODEL_FAMILIES;
  const [modelFamily, setModelFamily] = useState<string>(agent?.modelFamily ?? modelOptions[0].family);
  const [effort, setEffort] = useState<EffortLevel>(agent?.effort ?? DEFAULT_EFFORT);
  const initialPermissionMode: AgentInfo["permissionMode"] =
    agentType === "codex"
      ? (agent?.permissionMode ?? (isSpawn ? "never" : "on-request"))
      : agentType === "opencode"
        ? agent?.permissionMode === "bypassPermissions"
          ? "bypassPermissions"
          : (agent?.permissionMode ?? "default")
        : agent?.permissionMode === "auto" && !familyAllowsAutoPermission(agent?.modelFamily ?? MODEL_FAMILIES[0].family)
          ? "bypassPermissions"
          : (agent?.permissionMode ?? "auto");
  const [permissionMode, setPermissionMode] = useState<AgentInfo["permissionMode"]>(initialPermissionMode);
  const [codexSandbox, setCodexSandbox] = useState<CodexSandboxMode>(agent?.codexSandbox ?? "danger-full-access");
  const [selectedTemplateKey, setSelectedTemplateKey] = useState<string | null>(null);
  const [privileged, setPrivileged] = useState(agent?.privileged ?? false);
  const canTogglePrivileged = canToggleAgentPrivilege(isSpawn, sessionContext, agent);
  const [saving, setSaving] = useState(false);
  const [cwdError, setCwdError] = useState<string | null>(null);
  const pendingListener = useRef<((data: string) => void) | null>(null);
  const savePhase = useRef<"edit" | "privileged" | null>(null);
  const recentCwds = allRecentCwds.filter((c) => c !== cwd);
  const agentMemory = useMemoryEditor("agent", agent?.id ?? null, !isSpawn && !!agent);

  // Discard guard: dismissal (backdrop, Escape, Cancel, Move to Room) gates on
  // a confirm whenever any form field or memory is dirty; untouched forms
  // close as before. The memory editor stamps its own baseline when its async
  // load lands, so a programmatic re-seed never reads as a user edit.
  const currentSnapshot: EditAgentFormSnapshot = {
    name,
    cwd,
    outfit: JSON.stringify(outfit),
    customInstructions,
    modelFamily,
    agentType,
    permissionMode,
    codexSandbox,
    effort,
    privileged,
  };
  const baselineRef = useRef(currentSnapshot);
  const isDirty = isFormDirty(baselineRef.current, currentSnapshot) || agentMemory.dirty;

  function confirmDiscard(): boolean {
    if (saving) return false;
    return !isDirty || window.confirm("Discard unsaved changes?");
  }

  function requestClose() {
    if (confirmDiscard()) onClose();
  }

  // Tab close / reload with unsaved edits gets the browser's native prompt.
  useEffect(() => {
    if (!isDirty) return;
    const guard = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener("beforeunload", guard);
    return () => window.removeEventListener("beforeunload", guard);
  }, [isDirty]);

  useEffect(() => {
    return () => {
      if (pendingListener.current) removeRawListener(pendingListener.current);
    };
  }, []);

  // Validate the existing cwd when the edit dialog opens, so the user sees
  // immediately if the stored directory is gone.
  useEffect(() => {
    if (isSpawn || !agent) return;
    const initialCwd = agent.cwd;
    const reqId = `cwd-check-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const listener = (data: string) => {
      try {
        const msg = JSON.parse(data);
        if (msg.type === "cwd_validation" && msg.requestId === reqId) {
          removeRawListener(listener);
          if (!msg.ok) setCwdError(msg.error || "Invalid directory");
        }
      } catch {}
    };
    addRawListener(listener);
    send({ type: "request_cwd_validation", requestId: reqId, cwd: initialCwd });
    return () => removeRawListener(listener);
  }, [isSpawn, agent?.id]);

  useEffect(() => {
    if (!isSpawn) return;
    applySpawnEngineDefaults(agentType, modelFamily, setModelFamily, setPermissionMode, setCodexSandbox, setEffort);
  }, [agentType, isSpawn, modelFamily]);

  async function handleSave() {
    if (!isSpawn) {
      const memoryResult = await agentMemory.save();
      if (!memoryResult.ok) {
        setCwdError(memoryResult.message);
        return;
      }
    }
    const reqId = `agent-save-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const listener = (data: string) => {
      try {
        const msg = JSON.parse(data);
        if (msg.type === "agent_save_response" && msg.requestId === reqId) {
          if (msg.ok && savePhase.current === "edit" && canTogglePrivileged && privileged !== (agent!.privileged ?? false)) {
            savePhase.current = "privileged";
            send({ type: "set_agent_privileged", requestId: reqId, agentId: agent!.id, privileged });
            return;
          }
          removeRawListener(listener);
          pendingListener.current = null;
          setSaving(false);
          if (msg.ok) {
            savePhase.current = null;
            onClose();
          } else {
            savePhase.current = null;
            setCwdError(msg.error || "Save failed");
          }
        }
      } catch {}
    };

    if (isSpawn) {
      const targetRoomId = rooms[props.room!]?.id;
      setCwdError(null);
      setSaving(true);
      addRawListener(listener);
      pendingListener.current = listener;
      send({
        type: "spawn",
        requestId: reqId,
        name: name || `Agent ${props.deskIndex! + 1}`,
        cwd,
        permissionMode,
        desk: props.deskIndex!,
        roomId: targetRoomId,
        outfit,
        customInstructions: customInstructions.trim() || undefined,
        modelFamily,
        effort,
        agentType,
        codexSandbox: agentType === "codex" ? codexSandbox : undefined,
      });
    } else {
      const cmd: Extract<ClientCommand, { type: "edit_agent" }> = { type: "edit_agent", agentId: agent!.id };
      if (name.trim() && name.trim() !== agent!.name) cmd.name = name.trim();
      if (cwd.trim() && cwd.trim() !== agent!.cwd) cmd.cwd = cwd.trim();
      if (JSON.stringify(outfit) !== JSON.stringify(agent!.outfit)) cmd.outfit = outfit;
      const trimmedInstructions = customInstructions.trim();
      if (trimmedInstructions !== (agent!.customInstructions ?? "")) {
        cmd.customInstructions = trimmedInstructions;
        cmd.customInstructionsVersion = instructionsVersionAtOpen.current;
      }
      if (modelFamily !== agent!.modelFamily) cmd.modelFamily = modelFamily;
      if (agentType !== agent!.agentType) cmd.agentType = agentType;
      if (effort !== (agent!.effort ?? DEFAULT_EFFORT)) cmd.effort = effort;
      if (permissionMode !== agent!.permissionMode) cmd.permissionMode = permissionMode;
      if (agentType === "codex" && codexSandbox !== (agent!.codexSandbox ?? "danger-full-access")) cmd.codexSandbox = codexSandbox;
      const privilegedChanged = canTogglePrivileged && privileged !== (agent!.privileged ?? false);
      const hasAgentChanges = !!(cmd.name || cmd.cwd || cmd.outfit || cmd.customInstructions !== undefined || cmd.modelFamily || cmd.agentType || cmd.effort || cmd.permissionMode || cmd.codexSandbox);
      if (!hasAgentChanges && !privilegedChanged) {
        onClose();
        return;
      }
      setCwdError(null);
      if (privilegedChanged) {
        setSaving(true);
        addRawListener(listener);
        pendingListener.current = listener;
        if (hasAgentChanges) {
          cmd.requestId = reqId;
          savePhase.current = "edit";
          send(cmd);
        } else {
          savePhase.current = "privileged";
          send({ type: "set_agent_privileged", requestId: reqId, agentId: agent!.id, privileged });
        }
      } else if (cmd.cwd) {
        // Only round-trip through the server when we need cwd validation; other
        // edits have no failure mode worth blocking the dialog on.
        cmd.requestId = reqId;
        setSaving(true);
        savePhase.current = "edit";
        addRawListener(listener);
        pendingListener.current = listener;
        send(cmd);
      } else {
        send(cmd);
        onClose();
      }
    }
  }

  const title = isSpawn ? t("dialogs.agent.titleSpawn") : t("dialogs.agent.titleEdit");
  const deskNumber = isSpawn ? props.deskIndex! + 1 : agent!.desk + 1;
  const subtitle = isSpawn
    ? t("dialogs.agent.desk", { desk: deskNumber })
    : roomCount > 1
      ? t("dialogs.agent.roomDesk", { room: rooms[agent!.room]?.name ?? t("common.roomFallback", { number: agent!.room + 1 }), desk: deskNumber })
      : t("dialogs.agent.desk", { desk: deskNumber });

  function applyTemplate(template: AgentTemplate | null) {
    if (!isSpawn) return;
    if (template === null) {
      setSelectedTemplateKey(null);
      setName("");
      setCustomInstructions("");
      setOutfit(makeRandomOutfit());
      return;
    }
    const values = templateFormValues(template, agentType, { modelFamily, effort, permissionMode });
    setSelectedTemplateKey(template.key);
    setName(values.name);
    setCustomInstructions(values.customInstructions);
    setOutfit(values.outfit);
    setModelFamily(values.modelFamily);
    setEffort(values.effort);
    setPermissionMode(values.permissionMode);
  }

  return {
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
    setAgentType,
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
  };
}
