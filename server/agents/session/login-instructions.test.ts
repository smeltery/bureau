import { afterEach, expect, spyOn, test } from "bun:test";
import { displayLogContent, logContent } from "../../../shared/i18n/log-message.ts";
import { DEFAULT_AGENT_CAPABILITIES, type AgentInfo } from "../../../shared/types.ts";
import { getBackend } from "../../backends/index.ts";
import type { BackendSession, LoginInstructions } from "../../backends/types.ts";
import { getCodexLoginInstructions, LOGIN_INSTRUCTIONS as CODEX_LOGIN, ALREADY_AUTHED_INSTRUCTIONS as CODEX_AUTHED } from "../../backends/codex/config.ts";
import { getOpenCodeLoginInstructions, LOGIN_INSTRUCTIONS as OPENCODE_LOGIN, ALREADY_AUTHED_INSTRUCTIONS as OPENCODE_AUTHED } from "../../backends/opencode/config.ts";
import { createManagedAgent } from "../managed-factory.ts";
import { agents, logCache } from "../state.ts";
import { emitLoginInstructions } from "./diagnostics.ts";

const restores: (() => void)[] = [];
afterEach(() => {
  for (const restore of restores.splice(0)) restore();
  agents.clear();
  logCache.clear();
});

function agentInfo(id: string, agentType: AgentInfo["agentType"] = "claude"): AgentInfo {
  return {
    id,
    name: "Event Consumer Test",
    desk: 0,
    room: 0,
    cwd: process.cwd(),
    outfit: {
      hat: "none",
      color: "#000000",
      hair: "#000000",
      hairStyle: "short",
      skin: "#000000",
      beard: "none",
      accessory: null,
    },
    permissionMode: "default",
    modelFamily: "sonnet",
    agentType,
    capabilities: DEFAULT_AGENT_CAPABILITIES,
    state: "waiting_for_response",
    topic: null,
    topicStale: false,
    customInstructions: null,
  };
}

function managedAgent() {
  const managed = createManagedAgent({ info: agentInfo("login-test", "codex"), skillCwd: process.cwd(), slashCommands: [], skills: [] });
  agents.set(managed.info.id, managed);
  return managed;
}

test("login guidance keeps canonical English and literal command syntax in every language", () => {
  const cases: [LoginInstructions, string][] = [
    [getCodexLoginInstructions({ env: { OPENAI_API_KEY: "test-key" } }), CODEX_AUTHED],
    [getCodexLoginInstructions({ env: { CODEX_HOME: "/nonexistent-login-test-home" } }), CODEX_LOGIN],
    [getOpenCodeLoginInstructions({ env: { OPENCODE_API_KEY: "test-key" } }), OPENCODE_AUTHED],
    [getOpenCodeLoginInstructions({ env: {}, profileDir: "/tmp/member's profile" }), OPENCODE_LOGIN],
  ];
  for (const [instructions, english] of cases) {
    expect(instructions.text).toBe(english);
    expect(logContent(instructions.message!).content).toBe(english);
    const entry = { kind: "system" as const, ...logContent(instructions.message!) };
    for (const language of ["es", "ca", "zh"] as const) {
      const translated = displayLogContent(entry, language);
      expect(translated).not.toBe(english);
      expect(translated).not.toContain("test-key");
      for (const literal of english.match(/`[^`]+`/g) ?? []) expect(translated).toContain(literal);
    }
  }
  expect(cases[3][0].commands?.[0]).toContain("HOME='/tmp/member'\\''s profile/home'");
  expect(cases[3][0].commands?.[0]).toEndWith("opencode auth login");
});

test("notice metadata and exact terminal commands survive translated guidance", async () => {
  const managed = managedAgent();
  const instructions = getCodexLoginInstructions({ env: { CODEX_HOME: "/nonexistent-login-test-home" } });
  const spy = spyOn(getBackend("codex"), "getLoginInstructions").mockReturnValue(instructions);
  restores.push(() => spy.mockRestore());
  await emitLoginInstructions(managed.info.id, managed);
  const entries = logCache.get(managed.info.id)!;
  expect(entries[0].message).toEqual(instructions.message);
  expect(entries[0].content).toBe(CODEX_LOGIN);
  expect(entries[0].ephemeral).toBe(true);
  expect(entries[0].metadata).toMatchObject({ providerLogin: "codex", openConnections: true });
  expect(entries.slice(1).map((entry) => entry.content)).toEqual(instructions.commands!);
  for (const entry of entries.slice(1)) {
    expect(entry.kind).toBe("terminal-command");
    expect(entry.terminal?.command).toBe(entry.content);
    expect(displayLogContent(entry, "zh")).toBe(entry.content);
  }
});

test("custom backend guidance remains literal and lookup failures translate", async () => {
  const managed = managedAgent();
  const spy = spyOn(getBackend("codex"), "getLoginInstructions").mockReturnValue({ text: "Custom provider guidance {value}" });
  restores.push(() => spy.mockRestore());
  await emitLoginInstructions(managed.info.id, managed);
  expect(displayLogContent(logCache.get(managed.info.id)![0], "es")).toBe("Custom provider guidance {value}");
  spy.mockImplementation(() => {
    throw new Error("private provider details");
  });
  await emitLoginInstructions(managed.info.id, managed);
  const entry = logCache.get(managed.info.id)!.at(-1)!;
  expect(entry.message?.key).toBe("logs.login.unknown");
  expect(displayLogContent(entry, "zh")).toContain("无法检查");
  expect(JSON.stringify(entry)).not.toContain("private provider details");
});

test("late login guidance cannot leak into a replacement session", async () => {
  const managed = managedAgent();
  let resolve!: (instructions: LoginInstructions) => void;
  const pending = new Promise<LoginInstructions>((done) => {
    resolve = done;
  });
  const spy = spyOn(getBackend("codex"), "getLoginInstructions").mockReturnValue(pending);
  restores.push(() => spy.mockRestore());
  const emission = emitLoginInstructions(managed.info.id, managed);
  managed.session = {} as BackendSession;
  resolve({ text: "Old session guidance", commands: ["old command"] });
  await emission;
  expect(logCache.get(managed.info.id) ?? []).toHaveLength(0);
});
