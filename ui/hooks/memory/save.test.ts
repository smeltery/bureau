import { expect, test } from "bun:test";
import { saveMemory } from "./save.ts";

const write = { scope: "office" as const, scopeId: null, text: "Original notes\nwith {literal} content", version: "original-version" };

test("memory saves preserve payloads and require a usable returned version", async () => {
  const received: unknown[] = [];
  const server = Bun.serve({
    port: 0,
    async fetch(request) {
      received.push({ method: request.method, body: await request.json() });
      const path = new URL(request.url).pathname;
      if (path === "/valid") return Response.json({ version: "next-version" });
      if (path === "/empty") return new Response(null, { status: 204 });
      if (path === "/invalid-json") return new Response("not JSON");
      return Response.json({ version: path === "/number" ? 42 : "" });
    },
  });
  try {
    expect(await saveMemory(write, new URL("/valid", server.url).href)).toEqual({ ok: true, version: "next-version" });
    for (const path of ["/empty", "/invalid-json", "/number", "/blank"]) {
      const result = await saveMemory(write, new URL(path, server.url).href);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.message).toContain("Your edits are still available");
    }
    expect(received).toEqual(Array.from({ length: 5 }, () => ({ method: "PUT", body: write })));
  } finally {
    server.stop(true);
  }
});

test("memory failures preserve conflicts and server details and handle disconnected requests", async () => {
  const server = Bun.serve({
    port: 0,
    fetch(request) {
      const path = new URL(request.url).pathname;
      if (path === "/conflict") return Response.json({ error: { code: "memory_conflict", message: "canonical conflict" } }, { status: 409 });
      if (path === "/detail") return Response.json({ error: { message: "Original failure {value}" } }, { status: 403 });
      if (path === "/invalid") return Response.json({ error: { message: { invalid: true } } }, { status: 503 });
      return new Response("not JSON", { status: 502 });
    },
  });
  const url = server.url.href;
  try {
    const conflict = await saveMemory(write, new URL("/conflict", url).href);
    expect(conflict).toMatchObject({ ok: false, conflict: true });
    expect(await saveMemory(write, new URL("/detail", url).href)).toMatchObject({ ok: false, message: "Original failure {value}" });
    for (const path of ["/invalid", "/malformed"]) {
      const result = await saveMemory(write, new URL(path, url).href);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.message).toContain(path === "/invalid" ? "HTTP 503" : "HTTP 502");
    }
  } finally {
    server.stop(true);
  }
  const result = await saveMemory(write, url);
  expect(result.ok).toBe(false);
  if (!result.ok) expect(result.message).toContain("Could not confirm");
});
