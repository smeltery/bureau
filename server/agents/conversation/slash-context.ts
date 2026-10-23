import { logMessage, logParts, type LogParam } from "../../../shared/i18n/log-message.ts";
import { errMessage } from "../../../shared/errors.ts";
import { addLogEntry, type ManagedAgent } from "../state.ts";

export async function handleContextCommand(agentId: string, managed: ManagedAgent, _args: string[], rawText: string, username?: string): Promise<boolean> {
  const userMeta = username ? { username } : undefined;
  addLogEntry(agentId, "user_message", rawText, userMeta);
  if (!managed.session) {
    addLogEntry(agentId, "system", logMessage("logs.report.noSession"));
    return true;
  }
  try {
    const ctx = await managed.session.getContextUsage();
    if (!ctx) {
      addLogEntry(agentId, "system", logMessage("logs.report.contextUnavailable"));
      return true;
    }
    const lines: LogParam[] = [];

    const pct = Math.round(ctx.percentage);
    const barLen = 30;
    const filled = Math.max(0, Math.min(barLen, Math.round((barLen * ctx.percentage) / 100)));
    const bar = "\u2588".repeat(filled) + "\u2591".repeat(barLen - filled);
    lines.push(logMessage("logs.report.contextSummary", { model: ctx.model, used: { number: ctx.totalTokens }, limit: { number: ctx.maxTokens }, percent: { number: pct } }));
    lines.push(`\`${bar}\``);

    if ((ctx.categories?.length ?? 0) > 0) {
      lines.push("");
      for (const cat of ctx.categories ?? []) {
        if (cat.tokens > 0) {
          const catPct = (cat.tokens / ctx.maxTokens) * 100;
          lines.push(logMessage("logs.report.contextCategory", { name: cat.name, tokens: { number: cat.tokens }, percent: { number: catPct, digits: 1 } }));
        }
      }
    }

    if ((ctx.memoryFiles?.length ?? 0) > 0) {
      lines.push(logMessage("logs.report.memoryFiles"));
      for (const f of ctx.memoryFiles ?? []) {
        lines.push(logMessage("logs.report.memoryFile", { path: f.path, tokens: { number: f.tokens } }));
      }
    }

    if ((ctx.systemPromptSections?.length ?? 0) > 0) {
      lines.push(logMessage("logs.report.systemPrompt"));
      for (const s of ctx.systemPromptSections ?? []) {
        lines.push(logMessage("logs.report.promptSection", { name: s.name, tokens: { number: s.tokens } }));
      }
    }

    if (ctx.isAutoCompactEnabled && ctx.autoCompactThreshold) {
      const compactPct = Math.round((ctx.autoCompactThreshold / ctx.maxTokens) * 100);
      lines.push(logMessage("logs.report.compactAt", { percent: { number: compactPct }, tokens: { number: ctx.autoCompactThreshold } }));
    }

    addLogEntry(agentId, "system", logParts(lines.flatMap((line, index) => (index ? ["\n", line] : [line]))));
  } catch (err: any) {
    addLogEntry(agentId, "system", logMessage("logs.report.contextFailed", { error: errMessage(err) }));
  }
  return true;
}
