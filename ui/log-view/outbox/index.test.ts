import { expect, test } from "bun:test";
import { discardAttempt, outboxFor, resendAttempt, sendAttempt } from "./index.ts";

test("message retries classify failures without changing the delivery identity or payload", async () => {
  const originalFetch = globalThis.fetch;
  const bodies: unknown[] = [];
  const responses = [
    () => Promise.reject(new TypeError("Failed to fetch")),
    () => Promise.resolve(new Response("not JSON", { status: 503 })),
    () => Promise.resolve(Response.json({ error: "Literal server detail {value}" }, { status: 403 })),
    () => Promise.resolve(Response.json({ ok: true })),
  ];
  globalThis.fetch = (async (_url, init) => {
    bodies.push(JSON.parse(String(init?.body)));
    return responses.shift()!();
  }) as typeof fetch;
  const agentId = "outbox-failure-test";
  try {
    const attempt = sendAttempt({ agentId, text: "Literal draft", sendNow: true });
    expect(attempt).not.toBeNull();
    for (const error of [{ kind: "network" }, { kind: "http", status: 503 }, { kind: "server", message: "Literal server detail {value}" }] as const) {
      for (let n = 0; n < 100 && outboxFor(agentId)[0]?.status === "pending"; n++) await Bun.sleep(1);
      expect(outboxFor(agentId)[0]?.error).toEqual(error);
      expect(outboxFor(agentId)[0]?.text).toBe("Literal draft");
      resendAttempt(attempt!.id);
    }
    for (let n = 0; n < 100 && outboxFor(agentId).length; n++) await Bun.sleep(1);
    expect(outboxFor(agentId)).toEqual([]);
    expect(bodies).toHaveLength(4);
    for (const body of bodies) expect(body).toEqual({ text: "Literal draft", clientMessageId: attempt!.id, sendNow: true });
  } finally {
    globalThis.fetch = originalFetch;
    for (const attempt of outboxFor(agentId)) discardAttempt(attempt.id);
  }
});
