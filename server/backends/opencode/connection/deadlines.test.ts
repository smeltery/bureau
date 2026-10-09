import { afterEach, describe, expect, it } from "bun:test";
import type { NormalizedEvent } from "../../types.ts";
import type { OpenCodeLease, OpenCodeSupervisor } from "../supervisor.ts";
import { OpenCodeTransport } from "../transport.ts";
import { fetchOpenCode } from "./deadlines.ts";

const cleanup: Array<() => void> = [];
afterEach(() => {
  for (const dispose of cleanup.splice(0).reverse()) dispose();
});

describe("OpenCode deadlines", () => {
  it("bounds session creation even when the server never sends headers", async () => {
    const server = Bun.serve({ port: 0, fetch: () => new Promise<Response>(() => {}) });
    cleanup.push(() => server.stop(true));
    await expect(fetchOpenCode(new URL(`http://127.0.0.1:${server.port}/session`), { method: "POST" }, 30)).rejects.toThrow("timed out");
  });

  it("bounds a response body that stalls after its headers", async () => {
    const server = Bun.serve({
      port: 0,
      fetch: () =>
        new Response(
          new ReadableStream({
            start(c) {
              c.enqueue(new TextEncoder().encode('{"id":'));
            },
          }),
        ),
    });
    cleanup.push(() => server.stop(true));
    await expect(fetchOpenCode(new URL(`http://127.0.0.1:${server.port}/session`), {}, 30)).rejects.toThrow();
  });

  async function exerciseStream(heartbeat: boolean, stallFirstSubscription = false) {
    let prompts = 0;
    let subscriptions = 0;
    let recoveries = 0;
    let invalidated = 0;
    let ended = 0;
    let controller: ReadableStreamDefaultController<Uint8Array>;
    let pulse: ReturnType<typeof setInterval> | undefined;
    const encode = (text: string) => new TextEncoder().encode(text);
    const server = Bun.serve({
      port: 0,
      fetch(req) {
        const path = new URL(req.url).pathname;
        if (path === "/event" && ++subscriptions === 1 && stallFirstSubscription) return new Promise<Response>(() => {});
        if (path === "/event")
          return new Response(
            new ReadableStream({
              start(c) {
                controller = c;
                c.enqueue(encode(": connected\n\n"));
                if (heartbeat) pulse = setInterval(() => c.enqueue(encode(": heartbeat\n\n")), 15);
              },
              cancel() {
                clearInterval(pulse);
              },
            }),
          );
        if (path.endsWith("/prompt_async")) {
          prompts++;
          return new Response(null, { status: 204 });
        }
        return new Response(null, { status: 404 });
      },
    });
    cleanup.push(() => {
      clearInterval(pulse);
      server.stop(true);
    });
    const lease: OpenCodeLease = {
      baseUrl: `http://127.0.0.1:${server.port}`,
      authHeader: "Basic test",
      pid: 1,
      release() {},
      async beginTurn() {},
      async recoverBeforePrompt() {
        recoveries++;
      },
      endTurn() {
        ended++;
      },
      markUnresponsive() {
        invalidated++;
      },
    };
    const transport = new OpenCodeTransport({
      cwd: "/tmp",
      model: "test/model",
      systemPrompt: "stable",
      sessionId: "session-1",
      supervisor: { acquire: async () => lease } as unknown as OpenCodeSupervisor,
      requestTimeoutMs: 50,
      eventIdleTimeoutMs: 70,
    });
    cleanup.push(() => transport.close());
    const events: NormalizedEvent[] = [];
    await transport.send("hello", undefined, "agent-1", (event) => events.push(event));
    await Bun.sleep(180);
    if (heartbeat) {
      expect(events.filter((e) => e.kind === "turn_completed")).toHaveLength(0);
      controller!.enqueue(encode('data: {"type":"message.part.updated","properties":{"sessionID":"session-1","part":{"type":"step-finish","id":"step-1"}}}\n\n'));
      controller!.enqueue(encode('data: {"type":"session.idle","properties":{"sessionID":"session-1"}}\n\n'));
      await Bun.sleep(30);
    }
    const completed = events.filter((e) => e.kind === "turn_completed");
    expect(completed).toHaveLength(1);
    expect(completed[0]).toMatchObject({ status: heartbeat ? "completed" : "failed" });
    expect(prompts).toBe(1);
    expect(recoveries).toBe(stallFirstSubscription ? 1 : 0);
    expect(invalidated).toBe(heartbeat ? 0 : 1);
    expect(ended).toBe(1);
  }

  it("fails a silent stream once without replaying the accepted prompt", () => exerciseStream(false));
  it("lets heartbeat traffic keep a long turn alive", () => exerciseStream(true));
  it("recovers a stalled subscription before sending exactly one prompt", () => exerciseStream(true, true));
});
