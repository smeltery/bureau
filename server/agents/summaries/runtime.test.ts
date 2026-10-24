import { afterEach, expect, test } from "bun:test";
import { existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { DEFAULT_AGENT_CAPABILITIES, type AgentInfo } from "../../../shared/types.ts";
import type { OneShotOptions } from "../../backends/types.ts";
import { appendLog } from "../../persistence/logs/logs.ts";
import { saveSessionsMap } from "../../persistence/logs/sessions.ts";
import { readSessionSummary } from "../../persistence/logs/summary.ts";
import { LOGS_DIR } from "../../persistence/paths.ts";
import { createSummaryRunner } from "./runtime.ts";

const directories: string[] = [];
afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

function fixture(agentType: AgentInfo["agentType"] = "codex") {
  const id = `summary-runner-${crypto.randomUUID()}`;
  directories.push(join(LOGS_DIR, id));
  const info: AgentInfo = {
    id,
    name: "Summary test",
    desk: 0,
    room: 0,
    cwd: "/project",
    agentType,
    modelFamily: "selected-model",
    permissionMode: "default",
    userId: "alice",
    outfit: { hat: "none", color: "#000000", hair: "#000000", hairStyle: "short", skin: "#000000", beard: "none", accessory: null },
    capabilities: DEFAULT_AGENT_CAPABILITIES,
    state: "idle",
    topic: null,
    topicStale: false,
    customInstructions: null,
  };
  for (let i = 0; i < 4; i++) appendLog(id, "old", { id: `entry-${i}`, agentId: id, kind: "text", content: `Conversation ${i}`, timestamp: i });
  return { info };
}

test("captures provider and account before switching and writes only the captured session", async () => {
  const managed = fixture();
  const env = { CODEX_HOME: "/accounts/alice", BUREAU_AGENT_TOKEN: "private-office-token", BUREAU_RUN_TOKEN: "private-run-token" };
  let finish!: (value: string) => void;
  let sent: OneShotOptions | undefined;
  const run = createSummaryRunner({
    environment: () => ({ env, roomId: "room-a" }),
    backend: (type) => {
      expect(type).toBe("codex");
      return {
        capabilities: DEFAULT_AGENT_CAPABILITIES,
        getModelOptions: () => [{ value: "default-model", label: "Default" }],
        oneShotPrompt: (_prompt, options) => {
          sent = options;
          return new Promise((resolve) => {
            finish = resolve;
          });
        },
      };
    },
  });
  const pending = run(managed, "old");
  managed.info.agentType = "claude";
  managed.info.userId = "bob";
  env.CODEX_HOME = "/accounts/bob";
  await Promise.resolve();
  expect(sent).toMatchObject({ modelFamily: "default-model", cwd: "/tmp", environmentId: '["alice","room-a"]', env: { CODEX_HOME: "/accounts/alice" } });
  expect(sent?.env).not.toHaveProperty("BUREAU_AGENT_TOKEN");
  expect(sent?.env).not.toHaveProperty("BUREAU_RUN_TOKEN");
  expect(sent?.systemPrompt).toContain("Do not perform tasks");
  finish("Completed deployment work");
  await pending;
  expect(readSessionSummary(managed.info.id, "old")?.summary).toBe("Completed deployment work");
  expect(readSessionSummary(managed.info.id, "new")).toBeNull();
});

test("provider failures back off per account while credential changes permit another attempt", async () => {
  const managed = fixture("opencode");
  const env = { OPENCODE_API_KEY: "first-key" };
  let calls = 0;
  let errors = 0;
  const run = createSummaryRunner({
    environment: () => ({ env, roomId: "room" }),
    onError: () => {
      errors++;
    },
    backend: () => ({
      capabilities: DEFAULT_AGENT_CAPABILITIES,
      getModelOptions: () => [],
      async oneShotPrompt(_prompt, options) {
        expect(options.modelFamily).toBe("selected-model");
        calls++;
        if (options.env?.OPENCODE_API_KEY === "first-key") throw new Error("Provider unavailable");
        return "Summary after credential change";
      },
    }),
  });
  await run(managed, "old");
  await run(managed, "old");
  expect(calls).toBe(1);
  expect(errors).toBe(1);
  env.OPENCODE_API_KEY = "second-key";
  await run(managed, "old");
  expect(calls).toBe(2);
  expect(readSessionSummary(managed.info.id, "old")?.summary).toBe("Summary after credential change");
});

test("deleted sessions stay deleted when a captured generation finishes", async () => {
  const managed = fixture("claude");
  let finish!: (value: string) => void;
  const run = createSummaryRunner({
    environment: () => ({ env: {} }),
    backend: () => ({
      capabilities: DEFAULT_AGENT_CAPABILITIES,
      getModelOptions: () => [],
      oneShotPrompt(_prompt, options) {
        expect(options.modelFamily).toBe("sonnet");
        return new Promise((resolve) => {
          finish = resolve;
        });
      },
    }),
  });
  const pending = run(managed, "old");
  await Promise.resolve();
  const directory = join(LOGS_DIR, managed.info.id);
  rmSync(directory, { recursive: true });
  finish("Late result");
  await pending;
  expect(existsSync(directory)).toBe(false);
});

test("unsupported backends and absent transcripts make no provider calls", async () => {
  const managed = fixture();
  let supported = false;
  const run = createSummaryRunner({
    environment: () => ({ env: {} }),
    backend: () => ({
      capabilities: { ...DEFAULT_AGENT_CAPABILITIES, topicGen: supported },
      getModelOptions: () => [],
      async oneShotPrompt() {
        throw new Error("Must not generate");
      },
    }),
    onError() {
      throw new Error("Unexpected provider call");
    },
  });
  await run(managed, "old");
  supported = true;
  await run(managed, "missing");
  expect(readSessionSummary(managed.info.id, "old")?.summary).toBeUndefined();
});

test("production capture honors stored account paths without recreating missing metadata", async () => {
  for (const type of ["claude", "codex"] as const) {
    const managed = fixture(type);
    const key = type === "claude" ? "CLAUDE_CONFIG_DIR" : "CODEX_HOME";
    saveSessionsMap(managed.info.id, { old: { topic: null, lastModified: 1, claudeConfigDir: "/accounts/pinned-claude", codexHome: "/accounts/pinned-codex" } });
    const run = createSummaryRunner({
      backend: () => ({
        capabilities: DEFAULT_AGENT_CAPABILITIES,
        getModelOptions: () => [],
        async oneShotPrompt(_prompt, options) {
          expect(options.env?.[key]).toBe(`/accounts/pinned-${type}`);
          return "Pinned account summary";
        },
      }),
    });
    await run(managed, "old");
    const directory = join(LOGS_DIR, managed.info.id);
    rmSync(directory, { recursive: true });
    await run(managed, "old");
    expect(existsSync(directory)).toBe(false);
  }
});
