import { addLogEntry, officeConfig, rooms, updateState, type ManagedAgent } from "../state.ts";
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

export async function handleBureauCronjobSystemPromptCommand(agentId: string, _managed: ManagedAgent, args: string[], rawText: string, username?: string): Promise<boolean> {
  const userMeta = username ? { username } : undefined;
  addLogEntry(agentId, "user_message", rawText, userMeta);

  const query = args.join(" ").trim();
  const all = listCronjobs();

  if (!query) {
    const lines = ["Usage: `/bureau-cronjob-system-prompt <name-or-id>`"];
    if (all.length === 0) {
      lines.push("\nNo cron jobs are configured.");
    } else {
      lines.push("\nKnown cron jobs:");
      for (const c of all) lines.push(`  \`${c.id}\`  ${c.name}`);
    }
    addLogEntry(agentId, "system", lines.join("\n"));
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

  // The cronjob receives the system prompt + the configured prompt as its
  // first user message, so display both — that's the full initial input.
  const systemPrompt = buildCronjobSystemPrompt(target, target.id, "", buildCronjobMemoryPrompt());
  const combined = `${systemPrompt}\n\n----\nFirst user message:\n\n${target.prompt}`;
  const header = `**System prompt + first user message for cron job "${target.name}"** *(reflects current settings; takes effect on next run)*`;
  addLogEntry(agentId, "system", fencedPrompt(header, combined));
  updateState(agentId, "waiting_for_response");
  return true;
}

function fencedPrompt(header: string, content: string): string {
  // Pick a fence longer than any backtick run inside the prompt so the block
  // renders verbatim regardless of what office/room/agent prompts contain.
  const longestRun = (content.match(/`+/g) ?? []).reduce((m, s) => Math.max(m, s.length), 0);
  const fence = "`".repeat(Math.max(3, longestRun + 1));
  return `${header}\n\n${fence}plaintext\n${content}\n${fence}`;
}
