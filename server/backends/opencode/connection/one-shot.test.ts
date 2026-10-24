import { expect, test } from "bun:test";
import { createOpenCodeBackend } from "../adapter.ts";
import type { OpenCodeSupervisor } from "../supervisor.ts";

test("background sessions deny all tools and reject unexpected permission requests", async () => {
  let controller: ReadableStreamDefaultController<Uint8Array> | undefined;
  let sessionBody: unknown;
  let promptBody: unknown;
  let permissionReply: unknown;
  let released = false;
  const emit = (type: string, properties: Record<string, unknown>) =>
    controller!.enqueue(new TextEncoder().encode(`data: ${JSON.stringify({ type, properties: { sessionID: "summary", ...properties } })}\n\n`));
  const server = Bun.serve({
    port: 0,
    async fetch(request) {
      const path = new URL(request.url).pathname;
      if (path === "/provider") return Response.json({ connected: [], all: [] });
      if (path === "/session") {
        sessionBody = await request.json();
        return Response.json({ id: "summary" });
      }
      if (path === "/event")
        return new Response(
          new ReadableStream({
            start(stream) {
              controller = stream;
              stream.enqueue(new TextEncoder().encode(": ready\n\n"));
            },
          }),
          { headers: { "content-type": "text/event-stream" } },
        );
      if (path.endsWith("/prompt_async")) {
        promptBody = await request.json();
        emit("permission.asked", { id: "permission", permission: "bash", patterns: ["echo should-not-run"] });
        return new Response(null, { status: 204 });
      }
      if (path === "/permission/permission/reply") {
        permissionReply = await request.json();
        emit("message.updated", { info: { id: "message", role: "assistant" } });
        emit("message.part.updated", { part: { id: "part", messageID: "message", type: "text", text: "Conversation summary" } });
        emit("message.part.updated", { part: { id: "finish", messageID: "message", type: "step-finish" } });
        emit("session.idle", {});
        return new Response(null, { status: 204 });
      }
      return new Response(null, { status: 204 });
    },
  });
  const supervisor = {
    acquire: async (_env: unknown, mcp: unknown) => {
      expect(mcp).toBeUndefined();
      return {
        baseUrl: `http://127.0.0.1:${server.port}`,
        authHeader: "",
        pid: 1,
        release() {
          released = true;
        },
        async beginTurn() {},
        endTurn() {},
        async recoverBeforePrompt() {},
      };
    },
  } as unknown as OpenCodeSupervisor;
  try {
    const backend = createOpenCodeBackend({ supervisor });
    expect(await backend.oneShotPrompt("History", { modelFamily: "provider/model", systemPrompt: "Only summarize", timeoutMs: 1_000 })).toBe("Conversation summary");
    expect(sessionBody).toEqual({ title: "Bureau OpenCode session", permission: [{ permission: "*", pattern: "*", action: "deny" }] });
    expect(promptBody).toMatchObject({ system: "Only summarize" });
    expect(promptBody).not.toHaveProperty("agent");
    expect(permissionReply).toMatchObject({ reply: "reject" });
    expect(released).toBe(true);
  } finally {
    server.stop(true);
  }
});
