import { afterEach, describe, expect, test } from "bun:test";
import { CODEX_MODELS, DEFAULT_AGENT_CAPABILITIES, MODEL_FAMILIES } from "../../../../shared/types.ts";
import { createManagedAgent } from "../../managed-factory.ts";
import { agents, logCache } from "../../state.ts";
import { handleModelCommand } from "../slash-model-effort.ts";

function managedFor(agentType: "claude" | "codex" | "opencode", modelFamily: string) {
  const info = {
    id: `agent-${agentType}`,
    name: `${agentType} agent`,
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
  agents.set(info.id, managed);
  return managed;
}

afterEach(() => {
  agents.clear();
  logCache.clear();
});

describe("handleModelCommand", () => {
  test("offers Claude families for a Claude agent", async () => {
    const managed = managedFor("claude", "opus");
    await handleModelCommand(managed.info.id, managed, [], "/model");
    const prompt = (logCache.get(managed.info.id) ?? []).find((e) => e.metadata?.choicePrompt)?.metadata?.choicePrompt as { choices: { value: string }[] } | undefined;
    expect(prompt?.choices.map((c) => c.value)).toEqual(MODEL_FAMILIES.map((m) => m.family));
    expect(managed.pendingModelPick).toBe(true);
  });

  test("offers Codex models for a Codex agent, not Claude families", async () => {
    const managed = managedFor("codex", CODEX_MODELS[0]!.value);
    await handleModelCommand(managed.info.id, managed, [], "/model");
    const prompt = (logCache.get(managed.info.id) ?? []).find((e) => e.metadata?.choicePrompt)?.metadata?.choicePrompt as { choices: { value: string }[] } | undefined;
    const values = prompt?.choices.map((c) => c.value) ?? [];
    expect(values).toContain("gpt-5.6-terra");
    expect(values).not.toContain("opus");
    expect(managed.pendingModelPick).toBe(true);
  });

  test("routes OpenCode /model to settings instead of a Claude picker", async () => {
    const managed = managedFor("opencode", "provider/model");
    await handleModelCommand(managed.info.id, managed, [], "/model");
    const contents = (logCache.get(managed.info.id) ?? []).map((e) => e.content);
    expect(contents.some((c) => c.includes("Open agent settings"))).toBe(true);
    expect(managed.pendingModelPick).toBe(false);
  });
});
