import { EFFORT_LEVELS, MODEL_FAMILIES, effortDisplayLabel, familyDisplayLabel } from "../../../shared/types.ts";
import { emitEphemeralLog, updateState, type ManagedAgent } from "../state.ts";

export async function handleModelCommand(agentId: string, managed: ManagedAgent, _args: string[], rawText: string, username?: string): Promise<boolean> {
  const userMeta = username ? { username } : undefined;
  emitEphemeralLog(agentId, "user_message", rawText, userMeta);
  const currentLabel = familyDisplayLabel(managed.info.modelFamily);
  const lines: string[] = [`Switch model (current: **${currentLabel}**):\n`];
  const choices = MODEL_FAMILIES.map((model) => ({
    value: model.family,
    label: familyDisplayLabel(model.family),
    current: model.family === managed.info.modelFamily,
  }));
  lines.push(...choices.map((choice, index) => `  ${index + 1}. ${choice.label}${choice.current ? " (current)" : ""}`));
  const instruction = "\nReply with a number to switch, or anything else to cancel.";
  lines.push(instruction);
  emitEphemeralLog(agentId, "system", lines.join("\n"), {
    choicePrompt: {
      kind: "model",
      title: "Switch model",
      instruction: instruction.trim(),
      choices,
    },
  });
  managed.pendingModelPick = true;
  updateState(agentId, "waiting_for_response");
  return true;
}

export async function handleEffortCommand(agentId: string, managed: ManagedAgent, _args: string[], rawText: string, username?: string): Promise<boolean> {
  const userMeta = username ? { username } : undefined;
  emitEphemeralLog(agentId, "user_message", rawText, userMeta);
  const currentLabel = effortDisplayLabel(managed.info.effort);
  const lines: string[] = [`Switch thinking effort (current: **${currentLabel}**):\n`];
  const choices = EFFORT_LEVELS.map((effort) => ({
    value: effort.level,
    label: effortDisplayLabel(effort.level),
    current: effort.level === managed.info.effort,
  }));
  lines.push(...choices.map((choice, index) => `  ${index + 1}. ${choice.label}${choice.current ? " (current)" : ""}`));
  const instruction = "\nReply with a number to switch, or anything else to cancel.";
  lines.push(instruction);
  emitEphemeralLog(agentId, "system", lines.join("\n"), {
    choicePrompt: {
      kind: "effort",
      title: "Switch thinking effort",
      instruction: instruction.trim(),
      choices,
    },
  });
  managed.pendingEffortPick = true;
  updateState(agentId, "waiting_for_response");
  return true;
}
