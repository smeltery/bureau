import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

function isolated(script: string) {
  const home = mkdtempSync(join(tmpdir(), "bureau-usage-resume-"));
  try {
    const result = Bun.spawnSync(
      [
        process.execPath,
        "--eval",
        `
      import { expect, spyOn } from "bun:test";
      import { setupPrivilegedFixture, TARGET_AGENT } from "./server/http/__tests__/privileged-agent-fixture.ts";
      import { agents, beginTurn, logCache } from "./server/agents/state.ts";
      import { armUsageResume, cancelUsageResume, restoreUsageResume } from "./server/agents/conversation/usage-resume.ts";
      import * as queue from "./server/agents/conversation/message-queue.ts";
      import { abort } from "./server/agents/conversation/control.ts";
      import { editAgent } from "./server/agents/settings.ts";
      import { replaceSession } from "./server/agents/session/runtime.ts";
      import { displayLogContent } from "./shared/i18n/log-message.ts";
      import { loadAgents } from "./server/persistence.ts";
      setupPrivilegedFixture();
      const managed = agents.get(TARGET_AGENT);
      managed.sessionId = "saved-conversation";
      managed.info.state = "waiting_for_response";
      const sent = [];
      const enqueueSpy = spyOn(queue, "enqueueMessage").mockImplementation((id, message) => { sent.push({id, message}); return {ok:true, queued:false, messageId:"accepted"}; });
      let now = 1900000000000;
      const scheduled = new Map();
      const clock = { now: () => now, schedule: (run, delay) => { const token = {}; scheduled.set(token, { run, at: now + delay }); return () => scheduled.delete(token); } };
      function advance(ms) {
        now += ms;
        for (let loops = 0; loops < 10; loops++) {
          const ready = [...scheduled.entries()].filter(([, job]) => job.at <= now);
          if (!ready.length) return;
          for (const [token, job] of ready) { scheduled.delete(token); job.run(); }
        }
        throw new Error("timer loop");
      }
      ${script}
      cancelUsageResume(managed);
      process.exit(0);
    `,
      ],
      { env: { ...process.env, BUREAU_HOME: home }, stdout: "pipe", stderr: "pipe" },
    );
    expect(result.exitCode, result.stderr.toString()).toBe(0);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
}

test("quota continuation persists and sends once after the reset grace period", () => {
  isolated(`
    armUsageResume(managed, now + 1000, clock);
    expect(loadAgents().flatMap(r => r.agents).find(a => a.id === TARGET_AGENT).usageResumePlan).toEqual({ sessionId: "saved-conversation", dueAt: now + 61000 });
    const notice = logCache.get(TARGET_AGENT).find(entry => entry.message?.key === "logs.session.usageResume");
    expect(notice).toBeDefined();
    expect(displayLogContent(notice, "es")).toContain(new Intl.DateTimeFormat("es", { dateStyle: "medium", timeStyle: "short" }).format(now + 61000));
    advance(60999);
    expect(sent).toHaveLength(0);
    advance(1);
    expect(sent).toHaveLength(1);
    expect(sent[0].message.usageResume).toBe(true);
    expect(managed.usageResumePlan).toBeUndefined();
    advance(86400000);
    expect(sent).toHaveLength(1);
    armUsageResume(managed, now, clock);
    expect(scheduled.size).toBe(0);
  `);
});

test("Stop, new work, disabled setting and session replacement cancel scheduled work", () => {
  isolated(`
    armUsageResume(managed, now + 1000, clock);
    await abort(TARGET_AGENT);
    expect(scheduled.size).toBe(0);
    armUsageResume(managed, now + 1000, clock);
    beginTurn(TARGET_AGENT, { humanInput: true });
    expect(scheduled.size).toBe(0);
    managed.info.state = "waiting_for_response";
    armUsageResume(managed, now + 1000, clock);
    await editAgent(TARGET_AGENT, { resumeAfterUsageLimit: false });
    expect(scheduled.size).toBe(0);
    expect(loadAgents().flatMap(r => r.agents).find(a => a.id === TARGET_AGENT).resumeAfterUsageLimit).toBe(false);
    managed.info.resumeAfterUsageLimit = true;
    armUsageResume(managed, now + 1000, clock);
    await replaceSession(TARGET_AGENT, managed, { async *stream(){}, close(){} });
    expect(scheduled.size).toBe(0);
    advance(100000);
    expect(sent).toHaveLength(0);
  `);
});

test("restored plans retain their conversation and delay overdue work until boot settles", () => {
  isolated(`
    armUsageResume(managed, now + 1000, clock);
    const plan = loadAgents().flatMap(r => r.agents).find(a => a.id === TARGET_AGENT).usageResumePlan;
    cancelUsageResume(managed);
    advance(120000);
    restoreUsageResume(managed, plan, clock);
    advance(29999);
    expect(sent).toHaveLength(0);
    advance(1);
    expect(sent).toHaveLength(1);
    restoreUsageResume(managed, { ...plan, sessionId: "other" }, clock);
    expect(scheduled.size).toBe(0);
  `);
});

test("a pending member decision, changed conversation, or busy turn prevents automatic work", () => {
  isolated(`
    for (const change of [() => managed.pendingResume = true, () => managed.sessionId = "other", () => managed.info.state = "thinking", () => managed.info.state = "error", () => managed.flushHeld = true]) {
      managed.sessionId = "saved-conversation";
      managed.info.state = "waiting_for_response";
      managed.pendingResume = false;
      managed.flushHeld = false;
      armUsageResume(managed, now + 1000, clock);
      change();
      advance(61000);
      expect(managed.usageResumePlan).toBeUndefined();
    }
    expect(sent).toHaveLength(0);
  `);
});

test("long delays use bounded timers and stopping preserves ordinary queued messages", () => {
  isolated(`
    armUsageResume(managed, now + 7 * 86400000, clock);
    expect([...scheduled.values()][0].at - now).toBe(86400000);
    advance(86400000);
    expect(sent).toHaveLength(0);
    expect(scheduled.size).toBe(1);
    managed.messageQueue = [{id:"ordinary"}, {id:"automatic", usageResume:true}];
    cancelUsageResume(managed);
    expect(managed.messageQueue.map(m => m.id)).toEqual(["ordinary"]);
    for (const reset of [NaN, Infinity, -1, now, Number.MAX_SAFE_INTEGER]) armUsageResume(managed, reset, clock);
    expect(scheduled.size).toBe(0);
    managed.info.agentType = "opencode";
    armUsageResume(managed, now + 1000, clock);
    expect(scheduled.size).toBe(0);
  `);
});

test("a quota completion settles the active turn and arms continuation without entering error state", () => {
  isolated(`
    const { runConsumer } = await import("./server/agents/session/event-consumer.ts");
    const { createTurnDeferred } = await import("./server/agents/session/runtime.ts");
    const reset = Date.now() + 3600000;
    const session = { async *stream() { yield { kind: "turn_completed", status: "failed", error: "Usage limit reached", usageLimitResetAt: reset }; } };
    managed.session = session;
    const turn = createTurnDeferred(managed);
    await runConsumer(TARGET_AGENT, managed, session);
    await turn;
    expect(managed.info.state).toBe("waiting_for_response");
    expect(managed.usageResumePlan).toEqual({ sessionId: "saved-conversation", dueAt: reset + 60000 });
    cancelUsageResume(managed);
    await runConsumer(TARGET_AGENT, managed, session);
    expect(managed.usageResumePlan).toBeUndefined();
  `);
});

test("a due continuation uses the real queue and Stop cancels its pre-send wait", () => {
  isolated(`
    enqueueSpy.mockRestore();
    const actual = [];
    managed.session = {
      async send(text) {
        actual.push(text);
        const pending = managed.pendingTurn;
        managed.pendingTurn = null;
        managed.info.state = "waiting_for_response";
        pending?.resolve();
      },
      async getContextUsage() { return null; },
    };
    armUsageResume(managed, now + 1000, clock);
    queue.enqueueMessage(TARGET_AGENT, {sender:{kind:"user",username:"Member"},text:"Keep the pending request"});
    expect(actual).toHaveLength(0);
    advance(61000);
    for (let i = 0; i < 100 && managed.flushInProgress; i++) await new Promise(resolve => setTimeout(resolve, 5));
    expect(actual).toHaveLength(1);
    expect(actual[0]).toContain("[Bureau: the provider usage window has reset.");
    expect(actual[0]).toContain("Keep the pending request");
    expect(managed.messageQueue).toHaveLength(0);

    let release;
    let checking = false;
    managed.session.isKnownSignedOut = () => { checking = true; return new Promise(resolve => { release = resolve; }); };
    managed.info.state = "waiting_for_response";
    armUsageResume(managed, now + 1000, clock);
    advance(61000);
    for (let i = 0; i < 100 && !checking; i++) await new Promise(resolve => setTimeout(resolve, 5));
    expect(checking).toBe(true);
    await abort(TARGET_AGENT);
    release(false);
    for (let i = 0; i < 100 && managed.flushInProgress; i++) await new Promise(resolve => setTimeout(resolve, 5));
    expect(actual).toHaveLength(1);
    expect(managed.messageQueue).toHaveLength(0);
  `);
});
