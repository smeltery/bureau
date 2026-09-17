import { afterEach, describe, expect, it } from "bun:test";
import type { NormalizedEvent } from "../types.ts";
import type { OpenCodeLease, OpenCodeSupervisor } from "./supervisor.ts";
import { OpenCodeTransport } from "./transport.ts";

const cleanup: Array<() => void | Promise<void>> = [];
afterEach(async () => {
  for (const dispose of cleanup.splice(0).reverse()) await dispose();
});

function mockSupervisorWithPromptCapture(onPrompt: (system: string) => void): OpenCodeSupervisor {
  let eventController: ReadableStreamDefaultController<Uint8Array> | null = null;
  const server = Bun.serve({
    port: 0,
    async fetch(req) {
      const url = new URL(req.url);
      if (url.pathname === "/event") {
        return new Response(
          new ReadableStream({
            start(controller) {
              eventController = controller;
              controller.enqueue(new TextEncoder().encode(": connected\n\n"));
            },
          }),
          { headers: { "content-type": "text/event-stream" } },
        );
      }
      if (url.pathname === "/session" && req.method === "POST") {
        return Response.json({ id: "sess-stable-1" });
      }
      if (url.pathname.endsWith("/prompt_async") && req.method === "POST") {
        const body = (await req.json()) as { system: string };
        onPrompt(body.system);
        const controller = eventController;
        eventController = null;
        queueMicrotask(() => {
          controller?.enqueue(new TextEncoder().encode('data: {"type":"session.idle","properties":{"sessionID":"sess-stable-1"}}\n\n'));
        });
        return new Response(null, { status: 204 });
      }
      return new Response("not found", { status: 404 });
    },
  });
  cleanup.push(() => server.stop(true));
  const lease: OpenCodeLease = {
    baseUrl: `http://127.0.0.1:${server.port}`,
    authHeader: `Basic ${btoa("bureau:test")}`,
    pid: 1,
    release() {},
    async beginTurn() {},
    async recoverBeforePrompt() {},
    endTurn() {},
  };
  return {
    acquire: async () => lease,
    shutdown: async () => undefined,
  } as unknown as OpenCodeSupervisor;
}

async function awaitTurn(transport: OpenCodeTransport, text: string): Promise<void> {
  let resolveCompletion!: () => void;
  const completion = new Promise<void>((resolve) => {
    resolveCompletion = resolve;
  });
  await transport.send(text, undefined, "agent-opencode-test", (event: NormalizedEvent) => {
    if (event.kind === "turn_completed") resolveCompletion();
  });
  await completion;
}

describe("OpenCode transport system prompt stability", () => {
  it("sends a byte-identical system payload across consecutive session turns", async () => {
    const systemPayloads: string[] = [];
    const supervisor = mockSupervisorWithPromptCapture((system) => systemPayloads.push(system));
    const systemPrompt = "Bureau OpenCode office instructions — stable across turns.";
    const transport = new OpenCodeTransport({
      cwd: "/tmp",
      model: "opencode/gpt-5-nano",
      systemPrompt,
      supervisor,
      sessionId: "sess-stable-1",
    });

    try {
      await awaitTurn(transport, "turn-one");
      await awaitTurn(transport, "turn-two");
      expect(systemPayloads).toEqual([systemPrompt, systemPrompt]);
      expect(Buffer.from(systemPayloads[0]!)).toEqual(Buffer.from(systemPayloads[1]!));
    } finally {
      transport.close();
    }
  });
});

describe("OpenCode transport pre-prompt recovery", () => {
  it("recovers a failed event subscription before submitting one prompt", async () => {
    let subscriptions = 0;
    let recoveries = 0;
    let prompts = 0;
    let eventController: ReadableStreamDefaultController<Uint8Array> | null = null;
    const server = Bun.serve({
      port: 0,
      fetch(req) {
        const url = new URL(req.url);
        if (url.pathname === "/event") {
          subscriptions++;
          if (subscriptions === 1) return new Response("nope", { status: 503 });
          return new Response(
            new ReadableStream({
              start(controller) {
                eventController = controller;
                controller.enqueue(new TextEncoder().encode(": connected\n\n"));
              },
            }),
            { headers: { "content-type": "text/event-stream" } },
          );
        }
        if (url.pathname.endsWith("/prompt_async") && req.method === "POST") {
          prompts++;
          queueMicrotask(() => {
            eventController?.enqueue(new TextEncoder().encode('data: {"type":"session.idle","properties":{"sessionID":"sess-recover-1"}}\n\n'));
          });
          return new Response(null, { status: 204 });
        }
        return new Response("not found", { status: 404 });
      },
    });
    cleanup.push(() => server.stop(true));
    const lease: OpenCodeLease = {
      baseUrl: `http://127.0.0.1:${server.port}`,
      authHeader: `Basic ${btoa("bureau:test")}`,
      pid: 1,
      release() {},
      async beginTurn() {},
      async recoverBeforePrompt() {
        recoveries++;
      },
      endTurn() {},
    };
    const transport = new OpenCodeTransport({
      cwd: "/tmp",
      model: "opencode/gpt-5-nano",
      systemPrompt: "system",
      supervisor: {
        acquire: async () => lease,
      } as unknown as OpenCodeSupervisor,
      sessionId: "sess-recover-1",
    });

    try {
      await awaitTurn(transport, "go");
      expect(subscriptions).toBe(2);
      expect(recoveries).toBe(1);
      expect(prompts).toBe(1);
    } finally {
      transport.close();
    }
  });
});
