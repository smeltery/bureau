import { afterEach, expect, spyOn, test } from "bun:test";
import { installAgent } from "../../../http/__tests__/privileged-agent-fixture.ts";
import { agents, logCache, persistAll } from "../../state.ts";
import type { BackendSession } from "../../../backends/types.ts";
import { getBackend } from "../../../backends/index.ts";
import { runAgentTurn } from "../../../plugins/run-agent-turn.ts";
import { ProviderSignInRequiredError } from "../../../internal-types.ts";
import { SessionSwappedError } from "../../session/runtime.ts";
import { flushQueue } from "../message-queue.ts";
import { sendNow } from "../control.ts";

const restores: Array<() => void> = [];
afterEach(() => {
  for (const restore of restores.splice(0)) restore();
  agents.clear();
  logCache.clear();
  persistAll();
});

function fixture() {
  installAgent("sign-in-test", 0, "missing-manager");
  const managed = agents.get("sign-in-test")!;
  managed.info.agentType = "codex";
  let signedOut = true;
  let sends = 0;
  let checks = 0;
  const session: BackendSession = {
    async *stream() {},
    async getContextUsage() {
      return null;
    },
    async approve() {},
    async abort() {},
    close() {},
    canAbortInPlace() {
      return false;
    },
    async isKnownSignedOut() {
      checks++;
      return signedOut;
    },
    async send() {
      sends++;
      managed.info.state = "waiting_for_response";
      const pending = managed.pendingTurn;
      managed.pendingTurn = null;
      pending?.resolve();
    },
  };
  managed.session = session;
  const instructions = spyOn(getBackend("codex"), "getLoginInstructions").mockReturnValue({ text: "Sign in through Connections." });
  restores.push(() => instructions.mockRestore());
  return {
    managed,
    session,
    instructions,
    signIn: () => {
      signedOut = false;
    },
    sends: () => sends,
    checks: () => checks,
  };
}
const turn = (managed: ReturnType<typeof fixture>["managed"]) =>
  runAgentTurn({ managed, visibleText: "task", originalText: "task", sdkText: "task", username: null, origin: "user", humanInput: true });

test("known sign-out stops before send and preserves pending context", async () => {
  const f = fixture();
  f.managed.wakeNotice = "resume context";
  await expect(turn(f.managed)).rejects.toBeInstanceOf(ProviderSignInRequiredError);
  expect(f.sends()).toBe(0);
  expect(f.managed.pendingTurn).toBeNull();
  expect(f.managed.wakeNotice).toBe("resume context");
  expect(f.managed.info.state).toBe("waiting_for_response");
  expect(logCache.get(f.managed.info.id)?.filter((entry) => entry.kind === "error")).toEqual([]);
  expect(f.instructions).toHaveBeenCalledTimes(1);
});

test("queued work stays intact without retry loops and Send now can retry after sign-in", async () => {
  const f = fixture();
  f.managed.messageQueue.push({ id: "queued", sender: { kind: "user", username: "Boss" }, text: "keep this task", queuedAt: Date.now() });
  await flushQueue(f.managed.info.id);
  await new Promise((resolve) => setTimeout(resolve, 10));
  await flushQueue(f.managed.info.id);
  expect(f.checks()).toBe(1);
  expect(f.sends()).toBe(0);
  expect(f.managed.messageQueue).toHaveLength(1);
  f.signIn();
  await sendNow(f.managed.info.id);
  expect(f.sends()).toBe(1);
  expect(f.managed.messageQueue).toHaveLength(0);
  expect(f.instructions).toHaveBeenCalledTimes(1);
});

test("cancellation during the probe cannot block a replacement session", async () => {
  const f = fixture();
  let finish!: (value: boolean) => void;
  f.session.isKnownSignedOut = () =>
    new Promise((resolve) => {
      finish = resolve;
    });
  const pending = turn(f.managed);
  await new Promise((resolve) => setTimeout(resolve, 0));
  f.managed.turnCancelToken++;
  f.managed.session = { ...f.session };
  finish(true);
  await expect(pending).rejects.toBeInstanceOf(SessionSwappedError);
  expect(f.managed.providerSignInBlockedSession).toBeUndefined();
  expect(f.instructions).not.toHaveBeenCalled();
  expect(f.sends()).toBe(0);
});
