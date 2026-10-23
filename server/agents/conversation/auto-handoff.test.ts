import { displayLogContent } from "../../../shared/i18n/log-message.ts";
import { afterEach, expect, spyOn, test } from "bun:test";
import { DEFAULT_AGENT_CAPABILITIES, type AgentInfo, type LogEntry } from "../../../shared/types.ts";
import type { BackendSession } from "../../backends/types.ts";
import { claudeBackend } from "../../backends/claude.ts";
import { createManagedAgent } from "../managed-factory.ts";
import { agents, logCache, persistAll } from "../state.ts";
import { handoffThreshold, observeAutoHandoff } from "./auto-handoff.ts";
import { abort } from "./control.ts";

const spies: { mockRestore(): void }[] = [];
afterEach(() => {
  for (const spy of spies.splice(0)) spy.mockRestore();
  agents.clear();
  logCache.clear();
  persistAll();
});

function fixture(freshIsFull = false) {
  const info: AgentInfo = {
    id: "auto-handoff-test",
    name: "Automatic",
    desk: 0,
    room: 0,
    cwd: process.cwd(),
    outfit: { hat: "none", color: "#000000", hair: "#000000", hairStyle: "short", skin: "#000000", beard: "none", accessory: null },
    permissionMode: "default",
    modelFamily: "sonnet",
    agentType: "claude",
    capabilities: DEFAULT_AGENT_CAPABILITIES,
    state: "waiting_for_response",
    topic: null,
    topicStale: false,
    customInstructions: null,
    autoHandoff: true,
  };
  const managed = createManagedAgent({ info, skillCwd: process.cwd(), slashCommands: [], skills: [] });
  const sent: string[] = [];
  const notices: LogEntry[] = [];
  function session(brief = "Continue in src/widget.ts", full = true): BackendSession {
    return {
      async *stream() {},
      async getContextUsage() {
        return { model: "sonnet", totalTokens: full ? 180000 : 1000, maxTokens: 200000, percentage: full ? 90 : 0.5, categories: [] };
      },
      async send(text) {
        sent.push(text);
        notices.push(...(logCache.get(info.id) ?? []));
        observeAutoHandoff(managed, { kind: "assistant_text", text: brief });
        observeAutoHandoff(managed, { kind: "turn_completed", status: "completed" });
        const pending = managed.pendingTurn;
        managed.pendingTurn = null;
        managed.info.state = "waiting_for_response";
        pending?.resolve();
      },
      async approve() {},
      async abort() {},
      close() {},
      canAbortInPlace() {
        return false;
      },
    };
  }
  managed.session = session();
  agents.set(info.id, managed);
  spies.push(spyOn(claudeBackend, "createSession").mockImplementation(() => session("Next task", freshIsFull)));
  return { managed, sent, session, notices };
}

async function settle() {
  for (let i = 0; i < 20; i++) await Bun.sleep(5);
}

test("threshold leaves room before known compaction and caps large windows", () => {
  expect(handoffThreshold({ maxTokens: 200000 })).toBe(170000);
  expect(handoffThreshold({ maxTokens: 1000000 })).toBe(500000);
  expect(handoffThreshold({ maxTokens: 200000, compactAtTokens: 160000 })).toBe(150000);
});

test("automatic handoff writes a brief and preserves queued messages", async () => {
  const { managed, sent } = fixture();
  managed.messageQueue.push({ id: "queued", sender: { kind: "user", username: "Alex" }, text: "Also check tests", queuedAt: Date.now() });
  observeAutoHandoff(managed, { kind: "turn_completed", status: "completed" });
  await settle();
  expect(sent[0]).toContain("Reply only with a concise handoff brief");
  expect(sent[1]).toContain("Continue in src/widget.ts");
  expect(sent[1]).toContain("Also check tests");
  expect(sent[1]!.indexOf("Continue in src/widget.ts")).toBeLessThan(sent[1]!.indexOf("Also check tests"));
  expect(managed.messageQueue).toHaveLength(0);
});

test("an empty brief preserves the old session and spends only one attempt", async () => {
  const { managed, sent, session } = fixture();
  const original = session("");
  managed.session = original;
  observeAutoHandoff(managed, { kind: "turn_completed", status: "completed" });
  await settle();
  expect(managed.session).toBe(original);
  expect(managed.autoHandoffSpent).toBe(true);
  observeAutoHandoff(managed, { kind: "turn_completed", status: "completed" });
  await settle();
  expect(sent).toHaveLength(1);
  const notice = logCache.get(managed.info.id)!.find((entry) => entry.message?.key === "logs.action.handoffNoBrief")!;
  expect(displayLogContent(notice, "es")).toContain("/handoff");
  expect(displayLogContent(notice, "es")).not.toBe(notice.content);
});

test("Stop during measurement cancels the automatic handoff", async () => {
  const { managed, sent } = fixture();
  let release!: () => void;
  const original = managed.session!;
  const getUsage = original.getContextUsage.bind(original);
  original.getContextUsage = async () => {
    await new Promise<void>((resolve) => {
      release = resolve;
    });
    return getUsage();
  };
  observeAutoHandoff(managed, { kind: "turn_completed", status: "completed" });
  await abort(managed.info.id);
  release();
  await settle();
  expect(sent).toHaveLength(0);
  expect(managed.session).toBe(original);
  expect(managed.autoHandoffAttempt).toBeNull();
});

test("a fresh conversation already over threshold pauses instead of looping", async () => {
  const { managed, sent } = fixture(true);
  observeAutoHandoff(managed, { kind: "turn_completed", status: "completed" });
  await settle();
  expect(sent).toHaveLength(2);
  expect(managed.autoHandoffSpent).toBe(true);
  expect(logCache.get(managed.info.id)?.some((entry) => entry.content.includes("Automatic handoff paused"))).toBe(true);
});

test("per-agent token thresholds trigger early without bypassing context safety limits", async () => {
  expect(handoffThreshold({ maxTokens: 1000000 }, 250000)).toBe(250000);
  expect(handoffThreshold({ maxTokens: 200000 }, 900000)).toBe(170000);
  expect(handoffThreshold({ maxTokens: 200000, compactAtTokens: 160000 }, 900000)).toBe(150000);
  const { managed, sent, notices } = fixture();
  managed.info.autoHandoffTokens = 50000;
  managed.session!.getContextUsage = async () => ({ model: "sonnet", totalTokens: 49999, maxTokens: 200000, percentage: 25, categories: [] });
  observeAutoHandoff(managed, { kind: "turn_completed", status: "completed" });
  await settle();
  expect(sent).toHaveLength(0);
  managed.session!.getContextUsage = async () => ({ model: "sonnet", totalTokens: 50000, maxTokens: 200000, percentage: 25, categories: [] });
  observeAutoHandoff(managed, { kind: "turn_completed", status: "completed" });
  await settle();
  expect(sent[0]).toContain("Reply only with a concise handoff brief");
  const notice = notices.find((entry) => entry.message?.key === "logs.action.handoffPreparing")!;
  expect(notice.content).toBe("Context reached 25% (50,000 tokens). Writing an automatic handoff brief.");
  expect(displayLogContent(notice, "es")).toContain("50.000 tokens");
});
