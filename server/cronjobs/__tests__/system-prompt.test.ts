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

  test("documents inline diagram rendering options", () => {
    const prompt = buildCronjobSystemPrompt(cronjob(), "cron-1", "run-1");

    expect(prompt).toContain("```mermaid");
    expect(prompt).toContain("inline HTML");
    expect(prompt).toContain("var(--accent)");
  });

  test("documents run-level file and diff affordances", () => {
    const prompt = buildCronjobSystemPrompt(cronjob(), "cron-1", "run-1");

    expect(prompt).toContain("/cronjobs/cron-1/runs/run-1/read-file");
    expect(prompt).toContain("/cronjobs/cron-1/runs/run-1/diff");
    expect(prompt).toContain("clickable file chip");
  });
});
