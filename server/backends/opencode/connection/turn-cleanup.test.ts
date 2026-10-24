import { createTurnCleanup } from "./turn-cleanup.ts";
import { afterEach, expect, test } from "bun:test";
import type { NormalizedEvent } from "../../types.ts";
import type { OpenCodeSupervisor } from "../supervisor.ts";
import { OpenCodeTransport } from "../transport.ts";

const disposals: Array<() => void> = [];
afterEach(() => {
  for (const dispose of disposals.splice(0).reverse()) dispose();
});
const pause = () => new Promise<void>((resolve) => setTimeout(resolve, 5));
async function until(predicate: () => boolean) {
  for (let n = 0; n < 200; n++) {
    if (predicate()) return;
    await pause();
  }
  throw new Error("Expected provider operation did not arrive");
}

function fixture(options: { delayStop?: boolean; failStop?: boolean; delayFirstPrompt?: boolean; slowCatalog?: boolean; slowPermission?: boolean; recoverSubscription?: boolean } = {}) {
  let stream: ReadableStreamDefaultController<Uint8Array> | null = null;
  const streams = new Map<string, ReadableStreamDefaultController<Uint8Array>>();
  let stopResolve!: () => void;
  let promptResolve!: () => void;
  const stopWait = new Promise<void>((resolve) => (stopResolve = resolve));
  const promptWait = new Promise<void>((resolve) => (promptResolve = resolve));
  const calls: string[] = [];
  const stopAuth: string[] = [];
  let subscriptions = 0,
    auth = "Basic fixture",
    pid = 1;
  const replies: Array<{ id: string; reply: string }> = [];
  let ended = 0,
    invalidated = 0,
    prompts = 0,
    acquisitions = 0;
  const server = Bun.serve({
    port: 0,
    async fetch(req) {
      const url = new URL(req.url);
      const path = url.pathname;
      if (path === "/provider") {
        if (options.slowCatalog) await promptWait;
        return Response.json({ connected: ["other"], all: [{ id: "other", models: { model: {} } }] });
      }
      if (path === "/event" && options.recoverSubscription && ++subscriptions === 1) return new Response(null, { status: 503 });
      if (path === "/event")
        return new Response(
          new ReadableStream({
            start(controller) {
              streams.set(url.searchParams.get("directory")!, controller);
              if (url.searchParams.get("directory") === "/tmp/session") stream = controller;
              controller.enqueue(new TextEncoder().encode(": connected\n\n"));
            },
          }),
          { headers: { "content-type": "text/event-stream" } },
        );
      calls.push(path);
      if (path.endsWith("/prompt_async")) {
        prompts++;
        if (options.delayFirstPrompt && prompts === 1) {
          await promptWait;
          return new Response(null, { status: 503 });
        }
      }
      if (path.startsWith("/permission/")) {
        replies.push({ id: path.split("/")[2], ...(await req.json()) });
        if (options.slowPermission) await stopWait;
      }
      if (path.endsWith("/abort")) {
        stopAuth.push(req.headers.get("authorization")!);
        if (options.delayStop) await stopWait;
        if (options.failStop) return new Response(null, { status: 503 });
      }
      return new Response(null, { status: 204 });
    },
  });
  disposals.push(() => {
    stopResolve();
    promptResolve();
    server.stop(true);
  });
  const makeTransport = (sessionId: string) =>
    new OpenCodeTransport({
      cwd: `/tmp/${sessionId}`,
      model: "other/model",
      systemPrompt: "system",
      sessionId,
      requestTimeoutMs: 100,
      eventIdleTimeoutMs: 2000,
      supervisor: {
        acquire: async () => {
          acquisitions++;
          return {
            baseUrl: `http://127.0.0.1:${server.port}`,
            get authHeader() {
              return auth;
            },
            get pid() {
              return pid;
            },
            release() {},
            async beginTurn() {},
            async recoverBeforePrompt() {
              auth = "Basic recovered";
              pid++;
            },
            endTurn() {
              ended++;
            },
            markUnresponsive() {
              invalidated++;
            },
          };
        },
      } as unknown as OpenCodeSupervisor,
    });
  const transport = makeTransport("session");
  disposals.push(() => transport.close());
  const events: NormalizedEvent[] = [];
  const send = () => transport.send("hello", undefined, "agent", (event) => events.push(event));
  const emit = (...frames: object[]) => stream!.enqueue(new TextEncoder().encode(frames.map((properties) => `data: ${JSON.stringify(properties)}\n\n`).join("")));
  const permission = (id: string) => ({ type: "permission.asked", properties: { sessionID: "session", id, permission: "bash", patterns: ["echo hello"] } });
  const fail = () => ({ type: "session.error", properties: { sessionID: "session", error: { name: "APIError", data: { statusCode: 503 } } } });
  const idle = () => ({ type: "session.idle", properties: { sessionID: "session" } });
  const complete = () => emit({ type: "message.part.updated", properties: { part: { sessionID: "session", id: "step", messageID: "answer", type: "step-finish" } } }, idle());
  return {
    peer: () => {
      const peer = makeTransport("peer");
      disposals.push(() => peer.close());
      return peer;
    },
    emitPeer: (frames: object[]) => streams.get("/tmp/peer")!.enqueue(new TextEncoder().encode(frames.map((frame) => `data: ${JSON.stringify(frame)}\n\n`).join(""))),
    stopAuth,
    transport,
    send,
    emit,
    permission,
    fail,
    idle,
    complete,
    events,
    calls,
    replies,
    stopResolve,
    promptResolve,
    closeStream: () => stream!.close(),
    stats: () => ({ ended, invalidated, prompts, acquisitions }),
  };
}

test("failure rejects every unanswered permission and a late buffered permission before another prompt", async () => {
  const f = fixture({ delayStop: true });
  await f.send();
  f.emit(f.permission("one"), f.permission("two"), f.fail(), f.permission("late"));
  await until(() => f.calls.includes("/session/session/abort"));
  expect(f.events.filter((e) => e.kind === "approval_request")).toHaveLength(2);
  expect(f.replies).toEqual(
    expect.arrayContaining([
      { id: "one", reply: "reject" },
      { id: "two", reply: "reject" },
      { id: "late", reply: "reject" },
    ]),
  );
  await f.transport.approve("one", { kind: "allow_once" });
  expect(f.replies.every((r) => r.reply === "reject")).toBe(true);
  const next = f.send();
  await pause();
  expect(f.stats().prompts).toBe(1);
  expect(f.stats().ended).toBe(0);
  f.stopResolve();
  await next;
  expect(f.stats().prompts).toBe(2);
  expect(f.stats().ended).toBe(1);
  expect(f.stats().invalidated).toBe(0);
  f.complete();
  await until(() => f.events.filter((e) => e.kind === "turn_completed").length === 2);
  expect(f.calls.filter((p) => p.endsWith("/abort"))).toEqual(["/session/session/abort"]);
});

test("a healthy server's ended stream stops only the affected session", async () => {
  const f = fixture();
  await f.send();
  f.closeStream();
  await until(() => f.stats().ended === 1);
  expect(f.calls.filter((p) => p.endsWith("/abort"))).toEqual(["/session/session/abort"]);
  expect(f.stats().invalidated).toBe(0);
  expect(f.events.at(-1)).toMatchObject({ kind: "turn_completed", status: "failed" });
});

test("stop failure and a stuck stop are bounded and require process recovery", async () => {
  for (const options of [{ failStop: true }, { delayStop: true }]) {
    const f = fixture(options);
    await f.send();
    f.emit(f.fail());
    await until(() => f.stats().ended === 1);
    expect(f.stats().invalidated).toBeGreaterThan(0);
    expect(f.stats().prompts).toBe(1);
  }
});

test("a delayed old prompt response cannot abort or settle the next turn", async () => {
  const f = fixture({ delayFirstPrompt: true });
  const first = f.send();
  await until(() => f.stats().prompts === 1);
  f.emit(f.fail());
  await until(() => f.stats().ended === 1);
  await f.send();
  f.promptResolve();
  await first;
  expect(f.events.filter((e) => e.kind === "turn_completed")).toHaveLength(1);
  f.complete();
  await until(() => f.events.filter((e) => e.kind === "turn_completed").length === 2);
  expect(f.events.at(-1)).toMatchObject({ status: "completed" });
  expect(f.stats().invalidated).toBe(0);
});

test("Stop before a prompt is sent neither submits nor aborts a provider session", async () => {
  const f = fixture({ slowCatalog: true });
  const sending = f.send();
  await until(() => f.stats().acquisitions === 1);
  await pause();
  await f.transport.abort();
  f.promptResolve();
  await sending;
  expect(f.calls.filter((p) => p.endsWith("/abort") || p.endsWith("/prompt_async"))).toEqual([]);
  expect(f.events.at(-1)).toMatchObject({ kind: "turn_completed", status: "interrupted" });
});

test("cleanup leaves a live peer session on the same server untouched", async () => {
  const f = fixture();
  const peer = f.peer();
  const peerEvents: NormalizedEvent[] = [];
  await peer.send("peer work", undefined, "peer", (event) => peerEvents.push(event));
  await f.send();
  f.emit(f.fail());
  await until(() => f.stats().ended === 1);
  expect(peer.canAbortInPlace()).toBe(true);
  expect(f.stats().invalidated).toBe(0);
  expect(f.calls.filter((path) => path.endsWith("/abort"))).toEqual(["/session/session/abort"]);
  f.emitPeer([
    { type: "message.part.updated", properties: { part: { sessionID: "peer", id: "step", messageID: "answer", type: "step-finish" } } },
    { type: "session.idle", properties: { sessionID: "peer" } },
  ]);
  await until(() => peerEvents.some((event) => event.kind === "turn_completed"));
  expect(peerEvents.at(-1)).toMatchObject({ status: "completed" });
});

test("a stuck permission reply still leads to a bounded session stop", async () => {
  const f = fixture({ slowPermission: true });
  await f.send();
  f.emit(f.permission("stuck"), f.fail());
  await until(() => f.stats().ended === 1);
  expect(f.calls).toContain("/session/session/abort");
  expect(f.stats().invalidated).toBeGreaterThan(0);
});

test("settlement rejects unanswered permissions even on a completed turn", async () => {
  const f = fixture();
  await f.send();
  f.emit(f.permission("unanswered"));
  f.complete();
  await until(() => f.stats().ended === 1);
  expect(f.replies).toEqual([{ id: "unanswered", reply: "reject" }]);
  await f.transport.abort();
  expect(f.calls.some((path) => path.endsWith("/abort"))).toBe(false);
});

test("cleanup captures the recovered process after subscription recovery", async () => {
  const f = fixture({ recoverSubscription: true });
  await f.send();
  f.emit(f.fail());
  await until(() => f.stats().ended === 1);
  expect(f.stopAuth).toEqual(["Basic recovered"]);
});

test("old cleanup cannot target or invalidate a replacement process", async () => {
  const paths: string[] = [];
  const old = Bun.serve({
    port: 0,
    fetch(req) {
      paths.push(new URL(req.url).pathname);
      return new Response(null, { status: 503 });
    },
  });
  const replacement = Bun.serve({
    port: 0,
    fetch() {
      throw new Error("Cleanup reached the replacement");
    },
  });
  disposals.push(
    () => old.stop(true),
    () => replacement.stop(true),
  );
  let port = old.port,
    pid = 1,
    invalidated = 0;
  const lease = {
    get baseUrl() {
      return `http://127.0.0.1:${port}`;
    },
    authHeader: "Basic old",
    get pid() {
      return pid;
    },
    release() {},
    async beginTurn() {},
    async recoverBeforePrompt() {},
    endTurn() {},
    markUnresponsive() {
      invalidated++;
    },
  };
  const turn = createTurnCleanup(lease, "/tmp", "old-session", 50);
  turn.submitted = true;
  port = replacement.port;
  pid++;
  await turn.finish(true);
  expect(paths).toEqual(["/session/old-session/abort"]);
  expect(invalidated).toBe(0);
});

test("a prompt HTTP failure also stops the possibly accepted session without replay", async () => {
  const f = fixture({ delayFirstPrompt: true });
  f.promptResolve();
  await f.send();
  await until(() => f.stats().ended === 1);
  expect(f.calls.filter((path) => path.endsWith("/abort"))).toEqual(["/session/session/abort"]);
  expect(f.stats().prompts).toBe(1);
  expect(f.events.at(-1)).toMatchObject({ kind: "turn_completed", status: "failed" });
});
