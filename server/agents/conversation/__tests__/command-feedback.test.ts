import { emitAgentReadFile, emitAgentDiff } from "../../affordances.ts";
import { sendMessage } from "../send.ts";
import { QUEUE_MAX } from "../message-queue.ts";
import { afterEach, expect, spyOn, test } from "bun:test";
import { mkdtempSync, realpathSync, rmSync, writeFileSync, truncateSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEFAULT_AGENT_CAPABILITIES, type AgentInfo } from "../../../../shared/types.ts";
import { displayLogContent } from "../../../../shared/i18n/log-message.ts";
import { createManagedAgent } from "../../managed-factory.ts";
import { agents, logCache, persistAll, type ManagedAgent } from "../../state.ts";
import * as runtime from "../../session/runtime.ts";
import { commandHandlers } from "../slash-command-handlers.ts";
import { handleSlashCommand } from "../slash-commands.ts";
import { handleBureauDiffCommand, handleBureauEditCommand, handleBureauMessageCommand } from "../slash-bureau-tools.ts";

const directories: string[] = [];
function install(name = "Ada"): ManagedAgent {
  const cwd = mkdtempSync(join(realpathSync(tmpdir()), "bureau-command-feedback-"));
  directories.push(cwd);
  const info: AgentInfo = {
    id: `feedback-${crypto.randomUUID()}`,
    name,
    desk: 0,
    room: 0,
    cwd,
    outfit: { hat: "none", color: "#000", hair: "#000", hairStyle: "short", skin: "#000", beard: "none", accessory: null },
    permissionMode: "default",
    modelFamily: "sonnet",
    agentType: "claude",
    capabilities: DEFAULT_AGENT_CAPABILITIES,
    state: "waiting_for_response",
    topic: null,
    topicStale: false,
    customInstructions: null,
  };
  const managed = createManagedAgent({ info, skillCwd: cwd, slashCommands: [], skills: [] });
  agents.set(info.id, managed);
  return managed;
}
function last(managed: ManagedAgent) {
  return logCache.get(managed.info.id)!.at(-1)!;
}
afterEach(async () => {
  for (const managed of agents.values()) {
    managed.session?.close();
    await managed.consumerPromise;
  }
  agents.clear();
  logCache.clear();
  persistAll();
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

test("clear drops the real queue and emits singular/plural reader feedback", async () => {
  const create = spyOn(runtime, "createSession").mockImplementation(() => ({
    async *stream() {},
    async getContextUsage() {
      return null;
    },
    canAbortInPlace() {
      return false;
    },
    async send() {},
    async approve() {},
    async abort() {},
    close() {},
  }));
  try {
    for (const count of [0, 1, 2]) {
      const managed = install();
      managed.messageQueue = Array.from({ length: count }, (_, index) => ({ id: String(index), sender: { kind: "user", username: "Boss" }, text: "Queued text", queuedAt: 1 }));
      await commandHandlers.clear(managed.info.id, managed, [], "/clear", "Boss");
      expect(managed.messageQueue).toEqual([]);
      const entry = logCache.get(managed.info.id)!.find((log) => log.message?.key.startsWith("logs.command.cleared"))!;
      expect(entry.ephemeral).toBe(true);
      expect(entry.content).toBe(count ? `Conversation cleared. Dropped ${count} queued message${count === 1 ? "" : "s"}.` : "Conversation cleared.");
      expect(displayLogContent(entry, "es")).toBe(
        count === 0 ? "Conversación borrada." : count === 1 ? "Conversación borrada. Se descartó 1 mensaje en cola." : "Conversación borrada. Se descartaron 2 mensajes en cola.",
      );
    }
  } finally {
    create.mockRestore();
  }
});

test("unknown commands and handoff usage retain executable syntax", async () => {
  const managed = install();
  managed.info.agentType = "opencode";
  await handleSlashCommand(managed.info.id, managed, "not-a-command", [], "/not-a-command", "Boss");
  expect(displayLogContent(last(managed), "zh")).toBe("未知命令 `/not-a-command`。输入 `/help` 查看可用命令。");
  expect(logCache.get(managed.info.id)![0].content).toBe("/not-a-command");
  await commandHandlers.handoffApply(managed.info.id, managed, [], "/handoff-apply", "Boss");
  expect(displayLogContent(last(managed), "ca")).toBe("Ús: `/handoff-apply <handoff prompt>`");
});

test("file and diff failures translate wrappers while preserving paths", async () => {
  const managed = install();
  const missing = join(managed.info.cwd, "missing.txt");
  await handleBureauEditCommand(managed.info.id, managed, [missing], `/bureau-edit ${missing}`);
  expect(displayLogContent(last(managed), "es")).toBe(`\`${missing}\` no existe.`);
  const binary = join(managed.info.cwd, "binary.dat");
  writeFileSync(binary, Buffer.from([0, 1, 2, 0]));
  await handleBureauEditCommand(managed.info.id, managed, [binary], `/bureau-edit ${binary}`);
  expect(last(managed).message?.key).toBe("logs.command.binaryFile");
  await handleBureauDiffCommand(managed.info.id, managed, [], "/bureau-diff");
  expect(displayLogContent(last(managed), "ca")).toBe(`\`${managed.info.cwd}\` no és un repositori git.`);
});

test("peer messaging keeps the original recipient and queued text", async () => {
  const sender = install();
  const recipient = install("Ben original");
  recipient.info.state = "thinking";
  await handleBureauMessageCommand(sender.info.id, sender, [], "/bureau-message");
  const help = displayLogContent(last(sender), "es");
  expect(help).toContain("Otros agentes:");
  expect(help).toContain(`**Ben original**  \`${recipient.info.id}\``);
  await handleBureauMessageCommand(sender.info.id, sender, [recipient.info.id, "Original message"], "/bureau-message target Original message");
  expect(recipient.messageQueue[0].text).toBe("Original message");
  expect(displayLogContent(last(sender), "es")).toBe("En cola para **Ben original** (ocupado; se enviará cuando esté libre).");
});

test("roster composition translates labels while preserving member content", async () => {
  const managed = install("Ada original");
  managed.info.topic = "Original topic";
  const peer = install("Ben original");
  await commandHandlers.bureauAllHands(managed.info.id, managed, [], "/bureau-all-hands");
  const entry = last(managed);
  expect(entry.content).toContain("**=== Room 1 ===**");
  expect(entry.content).toContain("**Ada original** (desk 1)  **(me)**");
  expect(entry.content).toContain('<span style="color: var(--text-dim)">**Ben original**');
  const translated = displayLogContent(entry, "es");
  expect(translated).toContain("**=== Sala 1 ===**");
  expect(translated).toContain("**Ada original** (escritorio 1)  **(yo)**");
  expect(translated).toContain("Tema: Original topic");
  expect(translated).toContain(peer.info.cwd);
  await commandHandlers.usage(managed.info.id, managed, [], "/usage");
  expect(
    logCache
      .get(managed.info.id)!
      .slice(-2)
      .map((log) => log.terminal?.command),
  ).toEqual(["claude", "codex"]);
  const usage = logCache.get(managed.info.id)!.find((log) => log.message?.key === "logs.command.subscriptionUsage")!;
  expect(displayLogContent(usage, "zh")).toContain("`/bureau-usage`");
});

test("context reports translate counts while preserving provider details and overcapacity", async () => {
  const managed = install();
  managed.session = {
    async *stream() {},
    async send() {},
    async approve() {},
    async abort() {},
    close() {},
    canAbortInPlace() {
      return false;
    },
    async getContextUsage() {
      return {
        model: "Provider model",
        totalTokens: 12500,
        maxTokens: 10000,
        percentage: 125,
        categories: [{ name: "Provider category", tokens: 1250 }],
        memoryFiles: [{ path: "/project/NOTES.md", tokens: 250 }],
        systemPromptSections: [{ name: "Provider section", tokens: 500 }],
        isAutoCompactEnabled: true,
        autoCompactThreshold: 8000,
      };
    },
  };
  await commandHandlers.context(managed.info.id, managed, [], "/context");
  const entry = last(managed);
  expect(entry.content).toContain("125%");
  expect(entry.content).toContain("█".repeat(30));
  for (const language of ["en", "es", "ca", "zh"] as const) {
    const text = displayLogContent(entry, language);
    for (const literal of ["Provider model", "Provider category", "/project/NOTES.md", "Provider section"]) expect(text).toContain(literal);
    expect(text).toContain(new Intl.NumberFormat(language).format(12500));
  }
  managed.session.getContextUsage = async () => null;
  await commandHandlers.context(managed.info.id, managed, [], "/context");
  expect(last(managed).message?.key).toBe("logs.report.contextUnavailable");
  managed.session.getContextUsage = async () => {
    throw new Error("Provider detail");
  };
  await commandHandlers.context(managed.info.id, managed, [], "/context");
  expect(last(managed).message?.key).toBe("logs.report.contextFailed");
  expect(displayLogContent(last(managed), "es")).toContain("Provider detail");
  managed.session = null;
  await commandHandlers.context(managed.info.id, managed, [], "/context");
  expect(last(managed).message?.key).toBe("logs.report.noSession");
});

test("full queues preserve English API errors while translating the human notice", async () => {
  const managed = install();
  managed.info.state = "thinking";
  managed.messageQueue = Array.from({ length: QUEUE_MAX }, (_, index) => ({ id: String(index), sender: { kind: "user", username: "Boss" }, text: "Queued text", queuedAt: 1 }));
  const result = await sendMessage(managed.info.id, "New text", "Boss");
  expect(result).toEqual({ ok: false, error: `Message queue is full (limit ${QUEUE_MAX}). Try again after the agent finishes.` });
  expect(managed.messageQueue).toHaveLength(QUEUE_MAX);
  expect(last(managed).message?.key).toBe("logs.session.queueFull");
  expect(displayLogContent(last(managed), "zh")).toContain(`上限 ${QUEUE_MAX}`);
});

test("session startup errors retain provider details and recovery commands", async () => {
  const managed = install();
  const create = spyOn(runtime, "createSession").mockImplementation(() => {
    throw new Error("Provider diagnostic");
  });
  try {
    const result = await sendMessage(managed.info.id, "Original request", "Boss");
    expect(result).toEqual({ ok: false, error: "Cannot start session: Provider diagnostic" });
    expect(last(managed).message?.key).toBe("logs.session.cannotStart");
    const text = displayLogContent(last(managed), "es");
    for (const literal of ["Provider diagnostic", "/clear", "/resume"]) expect(text).toContain(literal);
    expect(logCache.get(managed.info.id)![0].content).toBe("Original request");
    expect(managed.info.state).toBe("error");
  } finally {
    create.mockRestore();
  }
});

test("file actions translate diagnostics without changing paths or file payloads", () => {
  const managed = install();
  const missing = join(managed.info.cwd, "original-name.txt");
  expect(emitAgentReadFile(managed.info.id, missing)).toEqual({ ok: true });
  expect(displayLogContent(last(managed), "es")).toBe(`\`${missing}\` no existe.`);
  emitAgentReadFile(managed.info.id, managed.info.cwd);
  expect(last(managed).message?.key).toBe("logs.command.notFile");
  const large = join(managed.info.cwd, "large.dat");
  writeFileSync(large, "");
  truncateSync(large, 21.5 * 1024 * 1024);
  emitAgentReadFile(managed.info.id, large);
  expect(last(managed).content).toContain("21.5 MB");
  expect(displayLogContent(last(managed), "es")).toContain("21,5 MB");
  writeFileSync(missing, "Original file contents");
  emitAgentReadFile(managed.info.id, missing);
  expect(last(managed).kind).toBe("file-view");
  expect(last(managed).content).toBe("original-name.txt");
  expect(last(managed).message).toBeUndefined();
});

test("diff actions retain API behavior, working directories and commit references", () => {
  const managed = install();
  expect(emitAgentDiff(managed.info.id)).toEqual({ ok: true });
  expect(last(managed).message?.key).toBe("logs.command.notRepository");
  expect(displayLogContent(last(managed), "ca")).toContain(managed.info.cwd);
  const init = Bun.spawnSync(["git", "init", "--quiet"], { cwd: managed.info.cwd, env: process.env });
  expect(init.exitCode).toBe(0);
  emitAgentDiff(managed.info.id);
  expect(last(managed).message?.key).toBe("logs.command.cleanTree");
  emitAgentDiff(managed.info.id, undefined, "missing-reference");
  expect(last(managed).message?.key).toBe("logs.action.badCommit");
  expect(displayLogContent(last(managed), "zh")).toContain("missing-reference");
});
