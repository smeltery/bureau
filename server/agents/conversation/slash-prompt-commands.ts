import { canViewSchedule } from "../../cronjobs/access.ts";
import { getUserById } from "../../users.ts";
import type { Cronjob } from "../../../shared/types.ts";
import { addLogEntry, emitEphemeralLog, officeConfig, rooms, updateState, type ManagedAgent } from "../state.ts";
import { buildSystemPrompt } from "../session/system-prompt.ts";
import { managerNameForAgent, buildMemoryPromptForAgent } from "../session/runtime.ts";
import { buildCronjobMemoryPrompt, buildCronjobSystemPrompt, listCronjobs } from "../../cronjobs/index.ts";

export async function handleBureauSystemPromptCommand(agentId: string, managed: ManagedAgent, _args: string[], rawText: string, username?: string): Promise<boolean> {
  const userMeta = username ? { username } : undefined;
  addLogEntry(agentId, "user_message", rawText, userMeta);
  const room = rooms[managed.info.room]!;
  const prompt = buildSystemPrompt(
    managed.info.name,
    agentId,
    room.name,
    officeConfig.prompt,
    room.prompt,
    managed.info.customInstructions,
    buildMemoryPromptForAgent(managed),
    managerNameForAgent(managed),
    null,
    managed.info.privileged ?? false,
  );
  addLogEntry(agentId, "system", fencedPrompt("**Full system prompt** *(reflects current settings; takes effect on next conversation)*", prompt));
  updateState(agentId, "waiting_for_response");
  return true;
}

export async function handleBureauCronjobSystemPromptCommand(agentId: string, managed: ManagedAgent, args: string[], rawText: string, username?: string): Promise<boolean> {
  const userMeta = username ? { username } : undefined;
  addLogEntry(agentId, "user_message", rawText, userMeta);

  const query = args.join(" ").trim();
  const all = listCronjobs().filter((job) => canViewSchedule(managed.info.userId ? getUserById(managed.info.userId) : null, job));

  if (!query) {
    if (all.length === 0) {
      addLogEntry(agentId, "system", "No cron jobs are configured.");
      updateState(agentId, "waiting_for_response");
      return true;
    }
    const instruction = "\nReply with a number to inspect, or anything else to cancel.";
    const choices = all.map((cronjob) => ({ value: cronjob.id, label: cronjob.name }));
    const lines = ["Inspect cron job system prompt:\n", ...choices.map((choice, index) => `  ${index + 1}. ${choice.label}`), instruction];
    emitEphemeralLog(agentId, "system", lines.join("\n"), {
      choicePrompt: {
        kind: "cronjob",
        title: "Inspect cron job prompt",
        instruction: instruction.trim(),
        choices,
      },
    });
    managed.pendingCronjobPick = true;
    updateState(agentId, "waiting_for_response");
    return true;
  }

  const byId = all.find((c) => c.id === query);
  const byNameMatches = byId ? [] : all.filter((c) => c.name === query);
  const target = byId ?? (byNameMatches.length === 1 ? byNameMatches[0] : null);

  if (!target) {
    if (byNameMatches.length > 1) {
      const lines = [`Multiple cron jobs are named "${query}". Re-run with the id:`];
      for (const c of byNameMatches) lines.push(`  \`${c.id}\``);
      addLogEntry(agentId, "system", lines.join("\n"));
    } else {
      addLogEntry(agentId, "system", `No cron job matches \`${query}\`. Try \`/bureau-cronjob-system-prompt\` with no argument to list cron jobs.`);
    }
    updateState(agentId, "waiting_for_response");
    return true;
  }

  emitCronjobPromptCard(agentId, target);
  updateState(agentId, "waiting_for_response");
  return true;
}

export function emitCronjobPromptCard(agentId: string, target: Cronjob): void {
  const systemPrompt = buildCronjobSystemPrompt(target, target.id, "", buildCronjobMemoryPrompt());
  const combined = `${systemPrompt}\n\n----\nFirst user message:\n\n${target.prompt}`;
  addLogEntry(agentId, "system", `**System prompt for "${target.name}"**`, {
    cronjobPromptContent: combined,
    cronjobName: target.name,
  });
}

function fencedPrompt(header: string, content: string): string {
  // Pick a fence longer than any backtick run inside the prompt so the block
  // renders verbatim regardless of what office/room/agent prompts contain.
  const longestRun = (content.match(/`+/g) ?? []).reduce((m, s) => Math.max(m, s.length), 0);
  const fence = "`".repeat(Math.max(3, longestRun + 1));
  return `${header}\n\n${fence}plaintext\n${content}\n${fence}`;
}
