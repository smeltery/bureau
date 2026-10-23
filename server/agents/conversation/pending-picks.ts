import { logMessage } from "../../../shared/i18n/log-message.ts";
import { armSettingsNotice } from "../session/settings-notice.ts";
import { canViewSchedule } from "../../cronjobs/access.ts";
import { getUserById } from "../../users.ts";
import { EFFORT_LEVELS, familyDisplayLabel, knownModelFamiliesFor } from "../../../shared/types.ts";
import { modelFamilyMismatchError } from "../../agent-validators.ts";
import { listCronjobs } from "../../cronjobs/index.ts";
import { addLogEntry, emit, emitEphemeralLog, persistAll, updateState } from "../state.ts";
import type { ManagedAgent } from "../state-types.ts";
import { createSession, replaceSession } from "../session/runtime.ts";
import { emitCronjobPromptCard } from "./slash-prompt-commands.ts";

export async function handlePendingModelPick(agentId: string, managed: ManagedAgent, text: string, username?: string): Promise<boolean> {
  if (!managed.pendingModelPick) return false;
  managed.pendingModelPick = false;
  const trimmed = text.trim();
  const num = parseInt(trimmed, 10);
  const models = knownModelFamiliesFor(managed.info.agentType) ?? [];
  if (!isNaN(num) && num >= 1 && num <= models.length) {
    const userMeta = username ? { username } : undefined;
    emitEphemeralLog(agentId, "user_message", text, userMeta);
    const picked = models[num - 1]!;
    const mismatch = modelFamilyMismatchError(managed.info.agentType, picked);
    if (mismatch) {
      emitEphemeralLog(agentId, "system", mismatch);
      return true;
    }
    const label = familyDisplayLabel(picked, managed.info.claudeModelOverrides);
    if (picked === managed.info.modelFamily) {
      emitEphemeralLog(agentId, "system", logMessage("logs.choice.alreadyUsing", { label }));
    } else {
      const before = { ...managed.info };
      managed.info.modelFamily = picked;
      const sessionId = managed.sessionId;
      const newSession = sessionId ? createSession(managed, sessionId) : createSession(managed);
      await replaceSession(agentId, managed, newSession);
      if (sessionId) armSettingsNotice(managed, before, username ?? "an office member", false);
      emit({ type: "agent_updated", agentId, changes: { modelFamily: picked } });
      persistAll();
      addLogEntry(agentId, "system", logMessage("logs.choice.modelSwitched", { label }));
    }
    return true;
  }
  emitEphemeralLog(agentId, "system", logMessage("logs.choice.modelCancelled"));
  return false;
}

export async function handlePendingEffortPick(agentId: string, managed: ManagedAgent, text: string, username?: string): Promise<boolean> {
  if (!managed.pendingEffortPick) return false;
  managed.pendingEffortPick = false;
  const trimmed = text.trim();
  const num = parseInt(trimmed, 10);
  if (!isNaN(num) && num >= 1 && num <= EFFORT_LEVELS.length) {
    const userMeta = username ? { username } : undefined;
    emitEphemeralLog(agentId, "user_message", text, userMeta);
    const picked = EFFORT_LEVELS[num - 1];
    const label = logMessage(`logs.effort.${picked.level}`);
    if (picked.level === managed.info.effort) {
      emitEphemeralLog(agentId, "system", logMessage("logs.choice.alreadyUsing", { label }));
    } else {
      const before = { ...managed.info };
      managed.info.effort = picked.level;
      const sessionId = managed.sessionId;
      const newSession = sessionId ? createSession(managed, sessionId) : createSession(managed);
      await replaceSession(agentId, managed, newSession);
      if (sessionId) armSettingsNotice(managed, before, username ?? "an office member", false);
      emit({ type: "agent_updated", agentId, changes: { effort: picked.level } });
      persistAll();
      addLogEntry(agentId, "system", logMessage("logs.choice.effortSwitched", { label }));
    }
    return true;
  }
  emitEphemeralLog(agentId, "system", logMessage("logs.choice.effortCancelled"));
  return false;
}

export async function handlePendingCronjobPick(agentId: string, managed: ManagedAgent, text: string, username?: string): Promise<boolean> {
  if (!managed.pendingCronjobPick) return false;
  managed.pendingCronjobPick = false;
  const trimmed = text.trim();
  const num = parseInt(trimmed, 10);
  const all = listCronjobs().filter((job) => canViewSchedule(managed.info.userId ? getUserById(managed.info.userId) : null, job));
  if (!isNaN(num) && num >= 1 && num <= all.length) {
    const userMeta = username ? { username } : undefined;
    emitEphemeralLog(agentId, "user_message", text, userMeta);
    emitCronjobPromptCard(agentId, all[num - 1]!);
    updateState(agentId, "waiting_for_response");
    return true;
  }
  emitEphemeralLog(agentId, "system", logMessage("logs.choice.cronjobCancelled"));
  return false;
}
