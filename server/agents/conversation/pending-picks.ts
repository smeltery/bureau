import { EFFORT_LEVELS, MODEL_FAMILIES, effortDisplayLabel, familyDisplayLabel } from "../../../shared/types.ts";
import { addLogEntry, emit, emitEphemeralLog, persistAll } from "../state.ts";
import type { ManagedAgent } from "../state-types.ts";
import { createSession, replaceSession } from "../session/runtime.ts";

export async function handlePendingModelPick(agentId: string, managed: ManagedAgent, text: string, username?: string): Promise<boolean> {
  if (!managed.pendingModelPick) return false;
  managed.pendingModelPick = false;
  const trimmed = text.trim();
  const num = parseInt(trimmed, 10);
  if (!isNaN(num) && num >= 1 && num <= MODEL_FAMILIES.length) {
    const userMeta = username ? { username } : undefined;
    emitEphemeralLog(agentId, "user_message", text, userMeta);
    const picked = MODEL_FAMILIES[num - 1];
    const label = familyDisplayLabel(picked.family);
    if (picked.family === managed.info.modelFamily) {
      emitEphemeralLog(agentId, "system", `Already using ${label}.`);
    } else {
      managed.info.modelFamily = picked.family;
      const sessionId = managed.sessionId;
      const newSession = sessionId ? createSession(managed, sessionId) : createSession(managed);
      await replaceSession(agentId, managed, newSession);
      emit({ type: "agent_updated", agentId, changes: { modelFamily: picked.family } });
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
