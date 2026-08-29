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
    agentType: "claude",
    modelFamily: "opus",
    effort: "xhigh",
    permissionMode: "bypassPermissions",
    enabled: true,
    createdBy: "Boss",
    userId: null,
    username: "Boss",
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

  test("documents boss attribution when creating tasks", () => {
    const prompt = buildCronjobSystemPrompt(cronjob(), "cron-1", "run-1");

    expect(prompt).toContain('"createdBy":"<boss-name>"');
    expect(prompt).toContain('If you can\'t tell, use "Daily report".');
  });

  test("documents creator-scoped agent discovery and desk-agent alerts", () => {
    const prompt = buildCronjobSystemPrompt(cronjob(), "cron-1", "run-1");

    expect(prompt).toContain("rooms your creator can access");
    expect(prompt).toContain("How to alert a desk agent during this run");
    expect(prompt).toContain("/api/agents/<receiver-id>/messages");
    expect(prompt).toContain("do not pass sendNow, steer, deliverAt, attachments, or senderAgentId");
  });
});
