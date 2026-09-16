import { EFFORT_LEVELS, effortDisplayLabel, familyDisplayLabel, knownModelFamiliesFor } from "../../../shared/types.ts";
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
    const label = familyDisplayLabel(picked);
    if (picked === managed.info.modelFamily) {
      emitEphemeralLog(agentId, "system", `Already using ${label}.`);
    } else {
      managed.info.modelFamily = picked;
      const sessionId = managed.sessionId;
      const newSession = sessionId ? createSession(managed, sessionId) : createSession(managed);
      await replaceSession(agentId, managed, newSession);
      emit({ type: "agent_updated", agentId, changes: { modelFamily: picked } });
      persistAll();
      addLogEntry(agentId, "system", `Model switched to ${label}. The agent's context may still say they are a different model — the correct model is shown in the top bar.`);
    }
    return true;
  }
  emitEphemeralLog(agentId, "system", "Model selection cancelled.");
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
    const label = effortDisplayLabel(picked.level);
    if (picked.level === managed.info.effort) {
      emitEphemeralLog(agentId, "system", `Already using ${label}.`);
    } else {
      managed.info.effort = picked.level;
      const sessionId = managed.sessionId;
      const newSession = sessionId ? createSession(managed, sessionId) : createSession(managed);
      await replaceSession(agentId, managed, newSession);
      emit({ type: "agent_updated", agentId, changes: { effort: picked.level } });
      persistAll();
      addLogEntry(agentId, "system", `Thinking effort set to ${label}.`);
    }
    return true;
  }
  emitEphemeralLog(agentId, "system", "Effort selection cancelled.");
  return false;
}

export async function handlePendingCronjobPick(agentId: string, managed: ManagedAgent, text: string, username?: string): Promise<boolean> {
  if (!managed.pendingCronjobPick) return false;
  managed.pendingCronjobPick = false;
  const trimmed = text.trim();
  const num = parseInt(trimmed, 10);
  const all = listCronjobs();
  if (!isNaN(num) && num >= 1 && num <= all.length) {
    const userMeta = username ? { username } : undefined;
    emitEphemeralLog(agentId, "user_message", text, userMeta);
    emitCronjobPromptCard(agentId, all[num - 1]!);
    updateState(agentId, "waiting_for_response");
    return true;
  }
  emitEphemeralLog(agentId, "system", "Cron job prompt selection cancelled.");
  return false;
}
