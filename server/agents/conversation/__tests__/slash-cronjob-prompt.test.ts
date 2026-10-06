import { claimUserByName, deleteUserById } from "../../../users.ts";
const fixtureUserIds: string[] = [];
import { afterEach, describe, expect, test } from "bun:test";
import { DEFAULT_AGENT_CAPABILITIES, type Cronjob } from "../../../../shared/types.ts";
import { setCronjobDefinitions } from "../../../cronjobs/cronjob-store.ts";
import { createManagedAgent } from "../../managed-factory.ts";
import { agents, logCache } from "../../state.ts";
import { handleBureauCronjobSystemPromptCommand } from "../slash-prompt-commands.ts";

function stubCronjob(overrides: Partial<Cronjob> = {}): Cronjob {
  return {
    id: "abcd1234",
    name: "Nightly check",
    schedule: { type: "daily", hour: 9, minute: 0 },
    prompt: "Check the office",
    cwd: process.cwd(),
    agentType: "claude",
    modelFamily: "opus",
    effort: "high",
    permissionMode: "never",
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

function managedFor() {
  const info = {
    id: "agent-cron-prompt",
    name: "Cron Prompt",
    desk: 0,
    room: 0,
    cwd: process.cwd(),
    outfit: { hat: "none" as const, color: "#000000", hair: "#000000", hairStyle: "short" as const, skin: "#000000", beard: "none" as const, accessory: null },
    permissionMode: "default" as const,
    modelFamily: "opus",
    effort: "high" as const,
    agentType: "claude" as const,
    capabilities: DEFAULT_AGENT_CAPABILITIES,
    state: "waiting_for_response" as const,
    topic: null,
    topicStale: false,
    customInstructions: null,
    customInstructionsVersion: "e3b0c44298fc",
  };
  const user = claimUserByName(crypto.randomUUID(), { role: "owner", allowedRooms: [] });
  fixtureUserIds.push(user.id);
  const managed = createManagedAgent({ info: { ...info, userId: user.id }, skillCwd: process.cwd(), slashCommands: [], skills: [] });
  agents.set(info.id, managed);
  return managed;
}

afterEach(() => {
  for (const id of fixtureUserIds.splice(0)) deleteUserById(id);
  agents.clear();
  logCache.clear();
  setCronjobDefinitions([]);
});

describe("handleBureauCronjobSystemPromptCommand", () => {
  test("no-arg with jobs opens a cronjob choice prompt", async () => {
    setCronjobDefinitions([stubCronjob(), stubCronjob({ id: "efgh5678", name: "Weekly digest" })]);
    const managed = managedFor();
    await handleBureauCronjobSystemPromptCommand(managed.info.id, managed, [], "/bureau-cronjob-system-prompt");
    const prompt = (logCache.get(managed.info.id) ?? []).find((e) => e.metadata?.choicePrompt)?.metadata?.choicePrompt as { kind: string; choices: { value: string; label: string }[] } | undefined;
    expect(prompt?.kind).toBe("cronjob");
    expect(prompt?.choices.map((c) => c.label)).toEqual(["Nightly check", "Weekly digest"]);
    expect(managed.pendingCronjobPick).toBe(true);
  });

  test("no-arg with empty list reports no cron jobs", async () => {
    const managed = managedFor();
    await handleBureauCronjobSystemPromptCommand(managed.info.id, managed, [], "/bureau-cronjob-system-prompt");
    expect((logCache.get(managed.info.id) ?? []).some((e) => e.content === "No cron jobs are configured.")).toBe(true);
    expect(managed.pendingCronjobPick).toBe(false);
  });

  test("resolved name emits a compact cronjob prompt card", async () => {
    setCronjobDefinitions([stubCronjob()]);
    const managed = managedFor();
    await handleBureauCronjobSystemPromptCommand(managed.info.id, managed, ["Nightly check"], "/bureau-cronjob-system-prompt Nightly check");
    const entry = (logCache.get(managed.info.id) ?? []).find((e) => typeof e.metadata?.cronjobPromptContent === "string");
    expect(entry?.content).toContain("Nightly check");
    expect(entry?.metadata?.cronjobName).toBe("Nightly check");
    expect(String(entry?.metadata?.cronjobPromptContent)).toContain("First user message:");
    expect(String(entry?.metadata?.cronjobPromptContent)).toContain("Check the office");
    expect(managed.pendingCronjobPick).toBe(false);
  });
});
