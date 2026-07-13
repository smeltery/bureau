import { addLogEntry, type ManagedAgent } from "../state.ts";

export async function handleContextCommand(agentId: string, managed: ManagedAgent, _args: string[], rawText: string, username?: string): Promise<boolean> {
  const userMeta = username ? { username } : undefined;
  addLogEntry(agentId, "user_message", rawText, userMeta);
  if (!managed.session) {
    addLogEntry(agentId, "system", "No active session.");
    return true;
  }
  try {
    const query = (managed.session as any).query;
    if (!query?.getContextUsage) {
      addLogEntry(agentId, "system", "Context usage not available for this session.");
      return true;
    }
    const ctx = await query.getContextUsage();
    const lines: string[] = [];

    const pct = Math.round(ctx.percentage);
    const barLen = 30;
    const filled = Math.round((barLen * ctx.percentage) / 100);
    const bar = "\u2588".repeat(filled) + "\u2591".repeat(barLen - filled);
    lines.push(`**${ctx.model}** \u2014 ${ctx.totalTokens.toLocaleString()} / ${ctx.maxTokens.toLocaleString()} tokens (${pct}%)`);
    lines.push(`\`${bar}\``);

    if (ctx.categories?.length > 0) {
      lines.push("");
      for (const cat of ctx.categories) {
        if (cat.tokens > 0) {
          const catPct = ((cat.tokens / ctx.maxTokens) * 100).toFixed(1);
          lines.push(`  ${cat.name}: ${cat.tokens.toLocaleString()} tokens (${catPct}%)`);
        }
      }
    }

    if (ctx.memoryFiles?.length > 0) {
      lines.push("\n**Memory files:**");
      for (const f of ctx.memoryFiles) {
        lines.push(`  ${f.path} (${f.tokens.toLocaleString()} tokens)`);
      }
    }

    if (ctx.systemPromptSections?.length > 0) {
      lines.push("\n**System prompt:**");
      for (const s of ctx.systemPromptSections) {
        lines.push(`  ${s.name}: ${s.tokens.toLocaleString()} tokens`);
      }
    }

    if (ctx.isAutoCompactEnabled && ctx.autoCompactThreshold) {
      const compactPct = Math.round((ctx.autoCompactThreshold / ctx.maxTokens) * 100);
      lines.push(`\nAuto-compact at ${compactPct}% (${ctx.autoCompactThreshold.toLocaleString()} tokens)`);
    }

    addLogEntry(agentId, "system", lines.join("\n"));
  } catch (err: any) {
    addLogEntry(agentId, "system", `Failed to get context usage: ${err.message}`);
  }
  return true;
}
