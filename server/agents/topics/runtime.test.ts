import { afterEach, expect, spyOn, test } from "bun:test";
import { rmSync } from "node:fs";
import { join } from "node:path";
import { DEFAULT_AGENT_CAPABILITIES } from "../../../shared/types.ts";
import { LOGS_DIR } from "../../persistence/paths.ts";
import { loadSessionsMap } from "../../persistence/logs/sessions.ts";
import { createManagedAgent } from "../managed-factory.ts";
import { agents, logCache } from "../state.ts";
import { generateTopic, installTopicGeneration, persistCurrentSessionTopic, setTopic } from "../topic.ts";

const cleanup: (() => void)[] = [];
afterEach(() => {
  for (const dispose of cleanup.splice(0).reverse()) dispose();
});

function fixture() {
  const id = `topic-runtime-${crypto.randomUUID()}`;
  const managed = createManagedAgent({
    info: {
      id,
      name: "Topic",
      desk: 0,
      room: 0,
      cwd: process.cwd(),
      agentType: "codex",
      modelFamily: "model",
      permissionMode: "default",
      outfit: { hat: "none", color: "#000000", hair: "#000000", hairStyle: "short", skin: "#000000", beard: "none", accessory: null },
      capabilities: DEFAULT_AGENT_CAPABILITIES,
      state: "idle",
      topic: "Original",
      topicStale: true,
      customInstructions: null,
    },
    skillCwd: process.cwd(),
    sessionId: "first",
    slashCommands: [],
    skills: [],
  });
  agents.set(id, managed);
  logCache.set(id, [{ id: "prompt", agentId: id, kind: "user_message", content: "Deployment question", timestamp: 1 }]);
  cleanup.push(() => {
    agents.delete(id);
    logCache.delete(id);
    rmSync(join(LOGS_DIR, id), { recursive: true, force: true });
  });
  return managed;
}

test("manual edits overtake generation and subsequent refresh keeps its own flag", async () => {
  const managed = fixture();
  const replies: ((text: string) => void)[] = [];
  cleanup.push(installTopicGeneration(() => ({ scope: managed.info.id, isAuthError: () => false, generate: () => new Promise((resolve) => replies.push(resolve)) })));
  const first = generateTopic(managed.info.id, true);
  expect(managed.info).toMatchObject({ topic: "Original", topicGenerating: true });
  setTopic(managed.info.id, "Typed label");
  expect(managed.info).toMatchObject({ topic: "Typed label", topicGenerating: false });
  const second = generateTopic(managed.info.id, true);
  replies[0]("Stale result");
  await first;
  expect(managed.info).toMatchObject({ topic: "Typed label", topicGenerating: true });
  replies[1]("New result");
  await second;
  expect(managed.info).toMatchObject({ topic: "New result", topicGenerating: false });
  expect(loadSessionsMap(managed.info.id).first.topic).toBe("New result");
});

test("session boundaries invalidate pending work before a new session generates", async () => {
  const managed = fixture();
  const replies: ((text: string) => void)[] = [];
  const sessions: string[] = [];
  cleanup.push(
    installTopicGeneration((_info, session) => {
      sessions.push(session);
      return { scope: managed.info.id, isAuthError: () => false, generate: () => new Promise((resolve) => replies.push(resolve)) };
    }),
  );
  const first = generateTopic(managed.info.id, true);
  persistCurrentSessionTopic(managed.info.id, managed);
  managed.sessionId = "second";
  managed.info.topic = null;
  const second = generateTopic(managed.info.id);
  replies[0]("Wrong conversation");
  await first;
  expect(managed.info).toMatchObject({ topic: null, topicGenerating: true });
  replies[1]("Correct conversation");
  await second;
  expect(sessions).toEqual(["first", "second"]);
  expect(loadSessionsMap(managed.info.id).first.topic).toBe("Original");
  expect(loadSessionsMap(managed.info.id).second.topic).toBe("Correct conversation");
});

test("automatic generation preserves labels and a cleared label can fill again", async () => {
  const managed = fixture();
  let calls = 0;
  cleanup.push(
    installTopicGeneration(() => ({
      scope: managed.info.id,
      isAuthError: () => false,
      generate: async () => {
        calls++;
        return "Filled label";
      },
    })),
  );
  await generateTopic(managed.info.id);
  expect(calls).toBe(0);
  setTopic(managed.info.id, " \n ");
  expect(loadSessionsMap(managed.info.id).first.topic).toBeNull();
  await generateTopic(managed.info.id);
  expect(calls).toBe(1);
  expect(managed.info.topic).toBe("Filled label");
});

test("failed refresh preserves the label and flags, and removed agents ignore late results", async () => {
  const managed = fixture();
  const diagnostic = spyOn(console, "error").mockImplementation(() => {});
  cleanup.push(() => diagnostic.mockRestore());
  cleanup.push(
    installTopicGeneration(() => ({
      scope: managed.info.id,
      isAuthError: () => false,
      generate: async () => {
        throw new Error("Private provider detail");
      },
    })),
  );
  await generateTopic(managed.info.id, true);
  expect(managed.info).toMatchObject({ topic: "Original", topicGenerating: false });
  expect(diagnostic.mock.calls.at(-1)).toEqual(["Topic generation failed"]);
  let finish!: (text: string) => void;
  cleanup.push(
    installTopicGeneration(() => ({
      scope: managed.info.id,
      isAuthError: () => false,
      generate: () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    })),
  );
  const pending = generateTopic(managed.info.id, true);
  agents.delete(managed.info.id);
  finish("Deleted agent label");
  await pending;
  expect(loadSessionsMap(managed.info.id)).toEqual({});
});
