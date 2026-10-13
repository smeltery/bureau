import { createHash } from "node:crypto";
import type { TokenUsage } from "../../types.ts";
import type { AllowedEvent } from "../parse.ts";

type Step = Extract<AllowedEvent, { kind: "step_finish" }>;

export class OpenCodeTurnAccounting {
  readonly summaries = new Set<string>();
  readonly steps = new Map<string, Step>();
  overflowPending = false;
  completed = false;

  record(step: Step): boolean {
    this.steps.set(step.partId, step);
    if (step.messageId && this.summaries.has(step.messageId)) return false;
    this.completed = true;
    this.overflowPending = false;
    return true;
  }

  totals(sessionId: string) {
    if (!this.steps.size) return {};
    const usage: TokenUsage = { inputTokens: 0, outputTokens: 0, cacheReadInputTokens: 0, cacheCreationInputTokens: 0 };
    let cost = 0;
    for (const step of this.steps.values()) {
      if (step.usage) for (const key of Object.keys(usage) as (keyof TokenUsage)[]) usage[key] += step.usage[key];
      cost += step.cost ?? 0;
    }
    const usageId = createHash("sha256")
      .update(JSON.stringify([sessionId, [...this.steps.keys()].sort()]))
      .digest("hex");
    return { usage, cost, costMode: "turn" as const, usageId };
  }
}
