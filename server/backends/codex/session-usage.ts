import type { ContextUsage, TokenUsage } from "../types.ts";
import { modelDisplayLabel } from "./config.ts";
import type { ThreadTokenUsageUpdatedNotification } from "./_generated/v2/ThreadTokenUsageUpdatedNotification.ts";

interface LastTurnBreakdown {
  inputNewTokens: number;
  inputCachedTokens: number;
  outputTokens: number;
  reasoningOutputTokens: number;
}

export class CodexUsageTracker {
  private lastCumulativeUsage: TokenUsage = {
    inputTokens: 0,
    outputTokens: 0,
    cacheReadInputTokens: 0,
    cacheCreationInputTokens: 0,
  };
  private modelContextWindow: number | null = null;
  private lastTurnBreakdown: LastTurnBreakdown | null = null;

  applyTokenUsageNotification(notif: ThreadTokenUsageUpdatedNotification): TokenUsage {
    const tu = notif.tokenUsage;
    const total = tu.total;
    const totalInput = total.inputTokens;
    const totalCached = total.cachedInputTokens;
    const totalOutput = total.outputTokens;
    const cumulative: TokenUsage = {
      inputTokens: Math.max(0, totalInput - totalCached),
      outputTokens: totalOutput,
      cacheReadInputTokens: totalCached,
      cacheCreationInputTokens: 0,
    };
    const delta: TokenUsage = {
      inputTokens: Math.max(0, cumulative.inputTokens - this.lastCumulativeUsage.inputTokens),
      outputTokens: Math.max(0, cumulative.outputTokens - this.lastCumulativeUsage.outputTokens),
      cacheReadInputTokens: Math.max(0, cumulative.cacheReadInputTokens - this.lastCumulativeUsage.cacheReadInputTokens),
      cacheCreationInputTokens: 0,
    };
    this.lastCumulativeUsage = cumulative;

    const last = tu.last;
    const lastInput = last.inputTokens;
    const lastCached = last.cachedInputTokens;
    const lastOutput = last.outputTokens;
    const lastReasoning = last.reasoningOutputTokens;
    if (tu.modelContextWindow !== null) {
      this.modelContextWindow = tu.modelContextWindow;
    }
    this.lastTurnBreakdown = {
      inputNewTokens: Math.max(0, lastInput - lastCached),
      inputCachedTokens: lastCached,
      outputTokens: Math.max(0, lastOutput - lastReasoning),
      reasoningOutputTokens: lastReasoning,
    };

    return delta;
  }

  getContextUsage(modelFamily: string): ContextUsage | null {
    if (this.lastTurnBreakdown === null || this.modelContextWindow === null || this.modelContextWindow <= 0) {
      return null;
    }
    const maxTokens = this.modelContextWindow;
    const b = this.lastTurnBreakdown;
    const totalTokens = b.inputNewTokens + b.inputCachedTokens + b.outputTokens + b.reasoningOutputTokens;
    const percentage = Math.min(100, (totalTokens / maxTokens) * 100);
    const categories = [
      { name: "Input (new)", tokens: b.inputNewTokens },
      { name: "Input (cached)", tokens: b.inputCachedTokens },
      { name: "Output", tokens: b.outputTokens },
      { name: "Reasoning", tokens: b.reasoningOutputTokens },
    ];
    return {
      model: modelDisplayLabel(modelFamily),
      totalTokens,
      maxTokens,
      percentage,
      categories,
    };
  }
}
