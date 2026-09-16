import { afterEach, describe, expect, test } from "bun:test";
import { CODEX_MODELS, DEFAULT_AGENT_CAPABILITIES, knownModelFamiliesFor, type Cronjob } from "../../../../shared/types.ts";
import { setCronjobDefinitions } from "../../../cronjobs/cronjob-store.ts";
import { createManagedAgent } from "../../managed-factory.ts";
import { agents, logCache } from "../../state.ts";
import { handlePendingCronjobPick, handlePendingModelPick } from "../pending-picks.ts";

function managedFor(agentType: "claude" | "codex", modelFamily: string) {
  const info = {
    id: `pick-${agentType}`,
    name: `${agentType} pick`,
    desk: 0,
    room: 0,
    cwd: process.cwd(),
    outfit: { hat: "none" as const, color: "#000000", hair: "#000000", hairStyle: "short" as const, skin: "#000000", beard: "none" as const, accessory: null },
    permissionMode: agentType === "codex" ? ("never" as const) : ("default" as const),
    modelFamily,
    effort: "high" as const,
    agentType,
    capabilities: DEFAULT_AGENT_CAPABILITIES,
    state: "waiting_for_response" as const,
    topic: null,
    topicStale: false,
    customInstructions: null,
    customInstructionsVersion: "e3b0c44298fc",
  };
  const managed = createManagedAgent({ info, skillCwd: process.cwd(), slashCommands: [], skills: [] });
  managed.pendingModelPick = true;
  agents.set(info.id, managed);
  return managed;
}

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

afterEach(() => {
  agents.clear();
  logCache.clear();
  setCronjobDefinitions([]);
});

describe("handlePendingModelPick", () => {
  test("resolves picks against the Codex list, not Claude families", async () => {
    const models = knownModelFamiliesFor("codex")!;
    expect(models[2]).toBe("gpt-5.6-terra");
    expect(models[2]).not.toBe("haiku");

    const managed = managedFor("codex", CODEX_MODELS[0]!.value);
    // Index 1 is the current Codex default — exercises the list without a session swap.
    await handlePendingModelPick(managed.info.id, managed, "1");
    expect(managed.info.modelFamily).toBe(CODEX_MODELS[0]!.value);
    expect((logCache.get(managed.info.id) ?? []).some((e) => e.content.startsWith("Already using"))).toBe(true);
  });

  test("cancels when the reply is not a list index", async () => {
    const managed = managedFor("codex", CODEX_MODELS[0]!.value);
    const handled = await handlePendingModelPick(managed.info.id, managed, "nope");
    expect(handled).toBe(false);
    expect(managed.info.modelFamily).toBe(CODEX_MODELS[0]!.value);
    expect((logCache.get(managed.info.id) ?? []).some((e) => e.content === "Model selection cancelled.")).toBe(true);
  });
});

describe("handlePendingCronjobPick", () => {
  test("emits a prompt card for a valid index", async () => {
    setCronjobDefinitions([stubCronjob(), stubCronjob({ id: "efgh5678", name: "Weekly digest", prompt: "Digest please" })]);
    const managed = managedFor("claude", "opus");
    managed.pendingModelPick = false;
    managed.pendingCronjobPick = true;
    const handled = await handlePendingCronjobPick(managed.info.id, managed, "2");
    expect(handled).toBe(true);
    expect(managed.pendingCronjobPick).toBe(false);
    const entry = (logCache.get(managed.info.id) ?? []).find((e) => typeof e.metadata?.cronjobPromptContent === "string");
    expect(entry?.metadata?.cronjobName).toBe("Weekly digest");
    expect(String(entry?.metadata?.cronjobPromptContent)).toContain("Digest please");
  });

  test("cancels when the reply is not a list index", async () => {
    setCronjobDefinitions([stubCronjob()]);
    const managed = managedFor("claude", "opus");
    managed.pendingModelPick = false;
    managed.pendingCronjobPick = true;
    const handled = await handlePendingCronjobPick(managed.info.id, managed, "nope");
    expect(handled).toBe(false);
    expect(managed.pendingCronjobPick).toBe(false);
    expect((logCache.get(managed.info.id) ?? []).some((e) => e.content === "Cron job prompt selection cancelled.")).toBe(true);
  });
});
