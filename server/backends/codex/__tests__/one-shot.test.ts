import { expect, test } from "bun:test";

test("background requests pass instructions and close on success, failure, or stalled startup and completion", () => {
  const result = Bun.spawnSync(
    [
      process.execPath,
      "--eval",
      `
      import { expect, mock } from "bun:test";
      let mode = "success";
      const clients = [];
      mock.module("./server/backends/codex/client.ts", () => ({ JsonRpcLiteClient: class {
        requests = []; closed = false; notify;
        constructor() { clients.push(this); }
        start() {}
        async initialize() { if (mode === "startup") await new Promise(() => {}); }
        onNotification(fn) { this.notify = fn; }
        async request(method, params) {
          this.requests.push({ method, params });
          if (method === "thread/start") return { thread: { id: "thread" } };
          if (method === "turn/start" && mode !== "completion") {
            this.notify({ method: "item/completed", params: { threadId: "thread", item: { type: "agentMessage", text: "Summary" } } });
            this.notify({ method: "turn/completed", params: { threadId: "thread", turn: { status: mode === "failure" ? "failed" : "completed" } } });
          }
        }
        async close() { this.closed = true; }
      } }));
      const { oneShotCodexPrompt } = await import("./server/backends/codex/backend-ops.ts");
      const opts = { modelFamily: "model", systemPrompt: "Only summarize", timeoutMs: 10 };
      expect(await oneShotCodexPrompt("Conversation", opts)).toBe("Summary");
      expect(clients[0].requests[0]).toMatchObject({ method: "thread/start", params: { baseInstructions: "Only summarize", model: "model", ephemeral: true, sandbox: "read-only" } });
      expect(clients[0].closed).toBe(true);
      for (mode of ["startup", "completion", "failure"]) {
        await expect(oneShotCodexPrompt("Conversation", opts)).rejects.toThrow(mode === "failure" ? "failed" : "timed out");
        expect(clients.at(-1).closed).toBe(true);
      }
    `,
    ],
    { env: process.env, stdout: "pipe", stderr: "pipe" },
  );
  expect(result.exitCode, result.stderr.toString()).toBe(0);
});
