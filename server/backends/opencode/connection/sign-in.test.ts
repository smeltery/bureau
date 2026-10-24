import { expect, test } from "bun:test";
import type { NormalizedEvent } from "../../types.ts";
import type { OpenCodeSupervisor } from "../supervisor.ts";
import { OpenCodeTransport } from "../transport.ts";
import { displayLogContent, logContent } from "../../../../shared/i18n/log-message.ts";

for (const provider of ["opencode", "opencode-go", "other"]) {
  for (const free of [true, false]) {
    for (const hasKey of [true, false]) {
      test(`${provider} sign-in failure with free=${free}, key=${hasKey}`, async () => {
        let controller: ReadableStreamDefaultController<Uint8Array>;
        let prompts = 0;
        let catalogs = 0;
        const model = `${provider}/example`;
        const server = Bun.serve({
          port: 0,
          fetch(request) {
            const path = new URL(request.url).pathname;
            if (path === "/provider") {
              catalogs++;
              return Response.json({ connected: [provider], all: [{ id: provider, models: { example: { cost: { input: free ? 0 : 1, output: free ? 0 : 1 } } } }] });
            }
            if (path === "/event")
              return new Response(
                new ReadableStream({
                  start(value) {
                    controller = value;
                    controller.enqueue(new TextEncoder().encode(": connected\n\n"));
                  },
                }),
                { headers: { "content-type": "text/event-stream" } },
              );
            if (path.endsWith("/prompt_async")) {
              prompts++;
              queueMicrotask(() =>
                controller.enqueue(
                  new TextEncoder().encode(
                    `data: ${JSON.stringify({ type: "session.error", properties: { sessionID: "s", error: { name: "APIError", data: { statusCode: 401, message: "Account access denied; token=private-value" } } } })}\n\n`,
                  ),
                ),
              );
              return new Response(null, { status: 204 });
            }
            return Response.json({ id: "s" });
          },
        });
        const lease = {
          baseUrl: `http://127.0.0.1:${server.port}`,
          authHeader: "Basic test",
          pid: 1,
          release() {},
          async beginTurn() {},
          async recoverBeforePrompt() {},
          endTurn() {},
          hasLaunchVariable: () => hasKey,
        };
        const transport = new OpenCodeTransport({ cwd: "/tmp", model, systemPrompt: "system", sessionId: "s", supervisor: { acquire: async () => lease } as unknown as OpenCodeSupervisor });
        try {
          let complete!: (event: Extract<NormalizedEvent, { kind: "turn_completed" }>) => void;
          const completion = new Promise<Extract<NormalizedEvent, { kind: "turn_completed" }>>((resolve) => {
            complete = resolve;
          });
          await transport.send("hello", undefined, "agent", (event) => {
            if (event.kind === "turn_completed") complete(event);
          });
          const event = await completion;
          expect(event.causedByAuth).toBe(provider !== "other" && !free && !hasKey);
          expect(event.error).toContain("Account access denied");
          expect(event).not.toHaveProperty("pickModel");
          expect(JSON.stringify(event)).not.toContain("private-value");
          expect(prompts).toBe(1);
          expect(catalogs).toBe(1);
          for (const language of ["en", "es", "ca", "zh"] as const) expect(displayLogContent({ kind: "error", ...logContent(event.errorMessage!) }, language)).toContain(model);
        } finally {
          transport.close();
          server.stop(true);
        }
      });
    }
  }
}
