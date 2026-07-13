import { EFFORT_LEVELS, MODEL_FAMILIES, effortDisplayLabel, familyDisplayLabel } from "../../../shared/types.ts";
import { emitEphemeralLog, updateState, type ManagedAgent } from "../state.ts";

export async function handleModelCommand(agentId: string, managed: ManagedAgent, _args: string[], rawText: string, username?: string): Promise<boolean> {
  const userMeta = username ? { username } : undefined;
  emitEphemeralLog(agentId, "user_message", rawText, userMeta);
  const currentLabel = familyDisplayLabel(managed.info.modelFamily);
  const lines: string[] = [`Switch model (current: **${currentLabel}**):\n`];
  for (let i = 0; i < MODEL_FAMILIES.length; i++) {
    const model = MODEL_FAMILIES[i];
    const marker = model.family === managed.info.modelFamily ? " (current)" : "";
    lines.push(`  ${i + 1}. ${familyDisplayLabel(model.family)}${marker}`);
  }
  lines.push("\nReply with a number to switch, or anything else to cancel.");
  emitEphemeralLog(agentId, "system", lines.join("\n"));
  managed.pendingModelPick = true;
  updateState(agentId, "waiting_for_response");
  return true;
}

export async function handleEffortCommand(agentId: string, managed: ManagedAgent, _args: string[], rawText: string, username?: string): Promise<boolean> {
  const userMeta = username ? { username } : undefined;
  emitEphemeralLog(agentId, "user_message", rawText, userMeta);
  const currentLabel = effortDisplayLabel(managed.info.effort);
  const lines: string[] = [`Switch thinking effort (current: **${currentLabel}**):\n`];
  for (let i = 0; i < EFFORT_LEVELS.length; i++) {
    const effort = EFFORT_LEVELS[i];
    const marker = effort.level === managed.info.effort ? " (current)" : "";
    lines.push(`  ${i + 1}. ${effortDisplayLabel(effort.level)}${marker}`);
  }
  lines.push("\nReply with a number to switch, or anything else to cancel.");
  emitEphemeralLog(agentId, "system", lines.join("\n"));
  managed.pendingEffortPick = true;
  updateState(agentId, "waiting_for_response");
  return true;
}
