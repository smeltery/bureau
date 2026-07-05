import { describe, expect, test } from "bun:test";
import type { Cronjob } from "../../../shared/types.ts";
import { buildCronjobSystemPrompt } from "../index.ts";

function cronjob(): Cronjob {
  return {
    id: "cron-1",
    name: "Daily report",
    schedule: { type: "daily", hour: 9, minute: 0 },
    prompt: "Summarize the day.",
    cwd: "/tmp",
    modelFamily: "opus",
    permissionMode: "auto",
    enabled: true,
    createdBy: "Boss",
    device: null,
    createdAt: 1,
    lastFireAt: null,
    nextFireAt: 2,
  };
}

describe("buildCronjobSystemPrompt", () => {
  test("places durable memory after configured instructions", () => {
    const prompt = buildCronjobSystemPrompt(cronjob(), "cron-1", "run-1", "Office memory:\n- Boss, 2026-07-04: Prefer short reports.");

    expect(prompt).toContain("## Durable Memory");
    expect(prompt).toContain("context to weigh");
    expect(prompt).toContain("Office memory:");
    expect(prompt.indexOf("How to read prior runs")).toBeLessThan(prompt.indexOf("## Durable Memory"));
  });
});
