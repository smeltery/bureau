import { afterEach, describe, expect, test } from "bun:test";
import type { Cronjob } from "../../../shared/types.ts";
import { claimUserByName, deleteUserById, updateUserById } from "../../users.ts";
import { buildCronjobSystemPrompt } from "../index.ts";

const createdUserIds: string[] = [];

afterEach(() => {
  for (const id of createdUserIds.splice(0)) deleteUserById(id);
});

function cronjob(overrides: Partial<Cronjob> = {}): Cronjob {
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
    ...overrides,
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

  test("documents authenticated globals-only task board usage", () => {
    const prompt = buildCronjobSystemPrompt(cronjob(), "cron-1", "run-1");

    expect(prompt).toContain("/api/tasks");
    expect(prompt).toContain("Authorization: Bearer $BUREAU_AGENT_TOKEN");
    expect(prompt).toContain("global (office-wide) tasks");
    expect(prompt).toContain("do not pass createdBy");
    expect(prompt).not.toContain('"createdBy":"<boss-name>"');
  });

  test("documents creator-scoped agent discovery and desk-agent alerts", () => {
    const prompt = buildCronjobSystemPrompt(cronjob(), "cron-1", "run-1");

    expect(prompt).toContain("rooms your creator can access");
    expect(prompt).toContain("How to alert a desk agent during this run");
    expect(prompt).toContain("/api/agents/<receiver-id>/messages");
    expect(prompt).toContain("do not pass sendNow, steer, deliverAt, attachments, or senderAgentId");
  });

  test("injects the creator memberPrompt looked up at build time", () => {
    const creator = claimUserByName(`Cron Prompt ${crypto.randomUUID()}`, { role: "member", allowedRooms: [] });
    createdUserIds.push(creator.id);
    expect(updateUserById(creator.id, { memberPrompt: "Prefer short reports." }).ok).toBe(true);

    const prompt = buildCronjobSystemPrompt(cronjob({ userId: creator.id, username: creator.name, createdBy: creator.name }), "cron-1", "run-1", "Shared cron rules.");

    expect(prompt).toContain(`## Special Instructions For ${creator.name}`);
    expect(prompt).toContain("Prefer short reports.");
    expect(prompt.indexOf("## Cron Jobs Instructions")).toBeLessThan(prompt.indexOf("## Special Instructions For"));
    expect(prompt.indexOf("Prefer short reports.")).toBeLessThan(prompt.indexOf("## Durable Memory"));
  });

  test("skips memberPrompt when the creator has none", () => {
    const creator = claimUserByName(`Cron Prompt Empty ${crypto.randomUUID()}`, { role: "member", allowedRooms: [] });
    createdUserIds.push(creator.id);
    const prompt = buildCronjobSystemPrompt(cronjob({ userId: creator.id, username: creator.name }), "cron-1", "run-1");
    expect(prompt).not.toContain("## Special Instructions For");
  });
});

test("OpenCode schedules use the active-turn proxy instead of an inherited bearer", () => {
  const prompt = buildCronjobSystemPrompt(cronjob({ agentType: "opencode", modelFamily: "opencode/gpt-5-nano" }), "cron-1", "run-1");
  expect(prompt).toContain("curl --unix-socket");
  expect(prompt).toContain("X-Bureau-Turn: __BUREAU_OPENCODE_TURN__");
  expect(prompt).toContain("http://bureau/api/cronjobs/cron-1/runs/run-1/read-file");
  expect(prompt).not.toContain("Authorization: Bearer");
  expect(prompt).not.toContain("$BUREAU_AGENT_TOKEN");
});
