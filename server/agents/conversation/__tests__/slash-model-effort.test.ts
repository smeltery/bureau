import { appendLog } from "../../../persistence/logs/logs.ts";
import { saveSessionsMap } from "../../../persistence/logs/sessions.ts";
import { commandHandlers } from "../slash-command-handlers.ts";
import { displayLogText } from "../../../../shared/i18n/log-message.ts";
import { afterEach, describe, expect, test } from "bun:test";
import { CODEX_MODELS, DEFAULT_AGENT_CAPABILITIES, MODEL_FAMILIES } from "../../../../shared/types.ts";
import { createManagedAgent } from "../../managed-factory.ts";
import { agents, logCache } from "../../state.ts";
import { handleEffortCommand, handleModelCommand } from "../slash-model-effort.ts";

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

test("the in-chat picker uses the session's cloud model labels", async () => {
  const managed = managedFor("claude", "sonnet");
  managed.info.claudeModelOverrides = { sonnet: "claude-sonnet-4-5", haiku: "custom-route" };
  await handleModelCommand(managed.info.id, managed, [], "/model");
  const content = (logCache.get(managed.info.id) ?? []).map((entry) => entry.content).join("\n");
  expect(content).toContain("Sonnet 4.5");
  expect(content).toContain("Haiku custom-route");
  expect(content).not.toContain("Sonnet 5.5");
});

test("model and effort cards retain command values while translating reader labels", async () => {
  const managed = managedFor("claude", "opus");
  await handleModelCommand(managed.info.id, managed, [], "/model");
  const model = logCache.get(managed.info.id)!.at(-1)!.metadata!.choicePrompt!;
  expect(displayLogText(model.title, model.titleMessage, "es")).toBe("Cambiar modelo");
  expect(model.choices[0].value).toBe("opus");
  expect(model.choices[0].labelMessage).toBeUndefined();
  await handleEffortCommand(managed.info.id, managed, [], "/effort");
  const effort = logCache.get(managed.info.id)!.at(-1)!.metadata!.choicePrompt!;
  const high = effort.choices.find((choice) => choice.value === "high")!;
  expect(displayLogText(effort.title, effort.titleMessage, "zh")).toBe("切换思考强度");
  expect(high.current).toBe(true);
  expect(high.label).toBe("High");
  expect(displayLogText(high.label, high.labelMessage, "ca")).toBe("Alt");
  expect(displayLogText(effort.instruction, effort.instructionMessage, "es")).toContain("Responde con un número");
});

test("resume choices localize saved dates while keeping session order and identifiers", async () => {
  const managed = managedFor("claude", "opus");
  managed.info.id = `resume-choice-${crypto.randomUUID()}`;
  agents.set(managed.info.id, managed);
  managed.sessionId = "current";
  const timestamp = Date.UTC(2026, 9, 23, 13, 45);
  for (const sessionId of ["current", "parent", "child"]) {
    appendLog(managed.info.id, sessionId, { id: sessionId, agentId: managed.info.id, timestamp, kind: "text", content: "Original" });
  }
  saveSessionsMap(managed.info.id, {
    current: { topic: "Current topic", lastModified: timestamp + 2 },
    parent: { topic: "Original topic", lastModified: timestamp + 1, cwd: "/tmp/project" },
    child: { topic: "Child topic", lastModified: timestamp, forkedFrom: "parent" },
  });
  await commandHandlers.resume(managed.info.id, managed, [], "/resume");
  const prompt = logCache.get(managed.info.id)!.at(-1)!.metadata!.choicePrompt!;
  expect(prompt.choices.map((choice) => choice.value)).toEqual(["parent", "child"]);
  expect(managed.pendingResumeSessions.map((session) => session.sessionId)).toEqual(["parent", "child"]);
  expect(displayLogText(prompt.title, prompt.titleMessage, "es")).toBe("Reanudar una conversación anterior");
  expect(prompt.choices[0].label).toBe("Original topic");
  const date = new Intl.DateTimeFormat("ca", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(timestamp + 1);
  expect(displayLogText(prompt.choices[0].description!, prompt.choices[0].descriptionMessage, "ca")).toBe(`${date}  /tmp/project  (ramificada)`);
});
