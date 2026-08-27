import { useEffect, useRef, useState } from "react";
import { addRawListener, removeRawListener, send } from "../../ws.ts";
import {
  CODEX_MODELS,
  DEFAULT_EFFORT,
  EFFORT_LEVELS,
  MODEL_FAMILIES,
  type AgentBackendType,
  type CodexSandboxMode,
  type Cronjob,
  type CronjobPermissionMode,
  type EffortLevel,
} from "../../../shared/types.ts";
import { buildCronjobSchedule, type ScheduleType } from "./CronjobScheduleFields.tsx";
import { shouldHostCloseOnEscape } from "./expandedEditorState.ts";

const DEFAULT_CODEX_CRONJOB_SANDBOX: CodexSandboxMode = "danger-full-access";

export function defaultCronjobCodexSandboxForTest(): CodexSandboxMode {
  return DEFAULT_CODEX_CRONJOB_SANDBOX;
}

export function useCronjobDialogState({ cronjob, username, onClose }: { cronjob?: Cronjob; username: string; onClose: () => void }) {
  const isEdit = !!cronjob;
  const [name, setName] = useState(cronjob?.name ?? "");
  const [scheduleType, setScheduleType] = useState<ScheduleType>(cronjob?.schedule.type ?? "daily");
  const initialHour = cronjob?.schedule.type === "interval" ? 9 : ((cronjob?.schedule as any)?.hour ?? 9);
  const initialMinute = cronjob?.schedule.type === "interval" ? 0 : ((cronjob?.schedule as any)?.minute ?? 0);
  const initialInterval = cronjob?.schedule.type === "interval" ? cronjob.schedule.minutes : 60;
  const [hourStr, setHourStr] = useState(String(initialHour));
  const [minuteStr, setMinuteStr] = useState(String(initialMinute));
  const [weekday, setWeekday] = useState<0 | 1 | 2 | 3 | 4 | 5 | 6>(cronjob?.schedule.type === "weekly" ? cronjob.schedule.weekday : 1);
  const [intervalStr, setIntervalStr] = useState(String(initialInterval));
  const [prompt, setPrompt] = useState(cronjob?.prompt ?? "");
  const [cwd, setCwd] = useState(cronjob?.cwd ?? "~");
  const [agentType, setAgentType] = useState<AgentBackendType>(cronjob?.agentType ?? "claude");
  const modelOptions = agentType === "codex" ? CODEX_MODELS.map((m) => ({ family: m.value, label: m.label })) : MODEL_FAMILIES;
  const [modelFamily, setModelFamily] = useState<string>(cronjob?.modelFamily ?? modelOptions[0].family);
  const [effort, setEffort] = useState<EffortLevel>(cronjob?.effort ?? DEFAULT_EFFORT);
  const [codexSandbox, setCodexSandbox] = useState<CodexSandboxMode>(cronjob?.codexSandbox ?? DEFAULT_CODEX_CRONJOB_SANDBOX);
  const [permissionMode, setPermissionMode] = useState<CronjobPermissionMode>(cronjob?.permissionMode ?? "bypassPermissions");
  const effortOptions = agentType === "codex" ? EFFORT_LEVELS : EFFORT_LEVELS.filter((e) => e.level !== "minimal" && (e.level !== "max" || modelFamily === "opus" || modelFamily === "fable"));
  const [enabled, setEnabled] = useState(cronjob?.enabled ?? true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const pendingListener = useRef<((data: string) => void) | null>(null);

  useEffect(() => {
    return () => {
      if (pendingListener.current) removeRawListener(pendingListener.current);
    };
  }, []);

  // An expanded editor (ExpandableTextarea) owns Escape while it is open, so
  // this capture listener — registered first — stands down for it.
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (shouldHostCloseOnEscape(e)) {
        e.stopPropagation();
        onClose();
      }
    }
    window.addEventListener("keydown", handleKey, true);
    return () => window.removeEventListener("keydown", handleKey, true);
  }, [onClose]);

  function handleSave() {
    if (!prompt.trim()) {
      setError("Prompt cannot be empty.");
      return;
    }
    const reqId = `cronjob-save-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    setError(null);
    setSaving(true);
    const listener = (data: string) => {
      try {
        const msg = JSON.parse(data);
        if (msg.type === "agent_save_response" && msg.requestId === reqId) {
          removeRawListener(listener);
          pendingListener.current = null;
          setSaving(false);
          if (msg.ok) onClose();
          else setError(msg.error || "Save failed");
        }
      } catch {}
    };
    addRawListener(listener);
    pendingListener.current = listener;

    if (isEdit) {
      send({
        type: "update_cronjob",
        requestId: reqId,
        id: cronjob!.id,
        changes: {
          name: name.trim() || cronjob!.name,
          schedule: buildCronjobSchedule({ scheduleType, hourStr, minuteStr, weekday, intervalStr }),
          prompt,
          cwd,
          modelFamily,
          effort,
          permissionMode,
          codexSandbox,
          enabled,
        },
      });
    } else {
      send({
        type: "add_cronjob",
        requestId: reqId,
        name: name.trim() || "Untitled cron job",
        schedule: buildCronjobSchedule({ scheduleType, hourStr, minuteStr, weekday, intervalStr }),
        prompt,
        cwd,
        modelFamily,
        effort,
        permissionMode,
        codexSandbox,
        username,
        agentType,
      });
    }
  }

  function handleDelete() {
    if (!cronjob) return;
    if (!confirmDelete) {
      setConfirmDelete(true);
      return;
    }
    send({ type: "delete_cronjob", id: cronjob.id });
    onClose();
  }

  function selectAgentType(next: AgentBackendType) {
    setAgentType(next);
    setModelFamily(next === "codex" ? CODEX_MODELS[0].value : MODEL_FAMILIES[0].family);
    setEffort(DEFAULT_EFFORT);
    setCodexSandbox(DEFAULT_CODEX_CRONJOB_SANDBOX);
    setPermissionMode(next === "codex" ? "never" : "bypassPermissions");
  }

  function selectModelFamily(next: string) {
    setModelFamily(next);
    if (effort === "max" && next !== "opus" && next !== "fable") setEffort(DEFAULT_EFFORT);
  }

  return {
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
  };
}
