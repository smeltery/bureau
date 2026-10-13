import { expect, test } from "bun:test";
import { rmSync } from "node:fs";
import { join } from "node:path";
import { LOGS_DIR, CRONJOBS_DIR } from "../paths.ts";
import { accumulateSessionUsage, rollSessionUsageOnResume } from "./sessions-usage.ts";
import { accumulateRunSessionUsage } from "../cronjob-run-sessions.ts";

const tokens = { inputTokens: 10, outputTokens: 2, cacheReadInputTokens: 0, cacheCreationInputTokens: 0 };
test("agent and scheduled turns add per-turn charges once and preserve cumulative providers", () => {
  const id = `turn-cost-test-${crypto.randomUUID()}`;
  try {
    const calls = [
      (cost: number, mode?: "turn", usageId?: string) => accumulateSessionUsage(id, "s", tokens, cost, mode, usageId),
      (cost: number, mode?: "turn", usageId?: string) => accumulateRunSessionUsage(id, "r", "s", tokens, cost, mode, usageId),
    ];
    for (const add of calls) {
      expect(add(1, "turn", "a").costUSD).toBe(1);
      expect(add(2, "turn", "b")).toMatchObject({ costUSD: 3, inputTokens: 20 });
      expect(add(2, "turn", "b")).toMatchObject({ costUSD: 3, inputTokens: 20 });
      expect(add(5).costUSD).toBe(5);
    }
    rollSessionUsageOnResume(id, "s");
    expect(accumulateSessionUsage(id, "s", tokens, 4, "turn", "c").costUSD).toBe(4);
  } finally {
    rmSync(join(LOGS_DIR, id), { recursive: true, force: true });
    rmSync(join(CRONJOBS_DIR, id), { recursive: true, force: true });
  }
});
