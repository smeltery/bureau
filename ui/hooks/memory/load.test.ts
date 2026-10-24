import { expect, test } from "bun:test";
import { loadMemory } from "./load.ts";

const data = { text: "Original notes {value}\nsecond line", version: "original-version", cap: 10000 };

test("memory loads require editable text, a concurrency version and a valid cap", async () => {
  const variants = [data, { ...data, text: null }, { ...data, version: "" }, { ...data, version: 42 }, { ...data, cap: -1 }, { ...data, cap: 1.5 }, {}];
  const server = Bun.serve({ port: 0, fetch: (request) => Response.json(variants[Number(new URL(request.url).pathname.slice(1))]) });
  try {
    expect(await loadMemory(new URL("/0", server.url).href)).toEqual({ ok: true, data });
    for (let index = 1; index < variants.length; index++) {
      expect(await loadMemory(new URL(`/${index}`, server.url).href)).toEqual({ ok: false, feedback: { key: "settingsUi.memoryLoadInvalid" } });
    }
  } finally {
    server.stop(true);
  }
});

test("memory load failures preserve server details and distinguish HTTP fallback", async () => {
  const server = Bun.serve({
    port: 0,
    fetch(request) {
      if (new URL(request.url).pathname === "/detail") return Response.json({ error: { message: "Literal rejection {value}" } }, { status: 403 });
      return new Response("not JSON", { status: 503 });
    },
  });
  const url = server.url;
  try {
    expect(await loadMemory(new URL("/detail", url).href)).toEqual({ ok: false, feedback: "Literal rejection {value}" });
    expect(await loadMemory(url.href)).toEqual({ ok: false, feedback: { memoryLoadStatus: 503 } });
  } finally {
    server.stop(true);
  }
  expect(await loadMemory(url.href)).toEqual({ ok: false, feedback: { key: "settingsUi.memoryLoadFailed" } });
});

test("memory loads stop on caller cancellation and a stalled response deadline", async () => {
  const server = Bun.serve({ port: 0, fetch: () => new Promise<Response>(() => {}) });
  try {
    const controller = new AbortController();
    const pending = loadMemory(server.url.href, controller.signal);
    controller.abort();
    expect(await pending).toEqual({ ok: false, feedback: { key: "settingsUi.memoryLoadFailed" } });
    expect(await loadMemory(server.url.href, undefined, 20)).toEqual({ ok: false, feedback: { key: "settingsUi.memoryLoadFailed" } });
  } finally {
    server.stop(true);
  }
});
