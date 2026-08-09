import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { createAppRegistry } from "../../apps/registry.ts";
import { createAppMessageLimiter, APP_MESSAGE_BURST_LIMIT, APP_MESSAGE_MAX_CHARS } from "../../apps/message-limits.ts";
import { handleAppSelfRequest, type AppSelfDeps } from "../app-self.ts";

// The app-self route with every collaborator injected: a real registry over a
// temp dir, a real limiter on a scripted clock, and a delivery fake. Nothing
// here touches systemd, agents, or the token store on disk.

let stateDir: string;
let deps: AppSelfDeps;
let delivered: { appName: string; targetAgentId: string; text: string }[];
let sendResult: ReturnType<AppSelfDeps["sendAsApp"]>;
let clock: number;

beforeEach(() => {
  stateDir = mkdtempSync(join(tmpdir(), "bureau-app-self-"));
  delivered = [];
  sendResult = { ok: true, messageId: "m1", queued: false };
  clock = 1_000_000;
  const registry = createAppRegistry({ dir: stateDir, probePort: () => true });
  registry.register({ name: "built-by-agent", command: "x", cwd: process.cwd(), userId: "user-1", username: "Ada", createdBy: "Scout", createdByAgentId: "agent-1" });
  registry.register({ name: "built-by-person", command: "x", cwd: process.cwd(), userId: "user-1", username: "Ada", createdBy: "Ada" });
  deps = {
    registry,
    limiter: createAppMessageLimiter({ now: () => clock }),
    sendAsApp: (appName, targetAgentId, text) => {
      delivered.push({ appName, targetAgentId, text });
      return sendResult;
    },
    resolveToken: (raw) => (raw.startsWith("tok-") ? { appName: raw.slice(4) } : null),
  };
});

afterEach(() => {
  if (stateDir.startsWith(tmpdir())) rmSync(stateDir, { recursive: true, force: true });
});

async function post(body: unknown, token: string | null = "tok-built-by-agent") {
  const req = new Request("http://local.test/api/app/message", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  });
  const res = await handleAppSelfRequest(req, new URL(req.url), deps);
  return { status: res?.status ?? 0, body: res ? await res.json() : null };
}

describe("app-self message route", () => {
  test("an app's message reaches the agent that built it, labelled server-side", async () => {
    const { status, body } = await post({ text: "the build finished" });

    expect(status).toBe(200);
    expect(body).toEqual({ messageId: "m1", queued: false });
    // The sender and the recipient both come from the token + registry, never
    // from the body.
    expect(delivered).toEqual([{ appName: "built-by-agent", targetAgentId: "agent-1", text: "the build finished" }]);
  });

  test("nothing in the body can redirect the message or rename the sender", async () => {
    await post({ text: "hi", appName: "built-by-person", targetAgentId: "agent-99", sender: "Ada" });

    expect(delivered[0]).toEqual({ appName: "built-by-agent", targetAgentId: "agent-1", text: "hi" });
  });

  test("only POST is served, and only at the app-self path", async () => {
    const get = new Request("http://local.test/api/app/message");
    expect((await handleAppSelfRequest(get, new URL(get.url), deps))?.status).toBe(405);
    const other = new Request("http://local.test/api/app/other", { method: "POST" });
    expect(await handleAppSelfRequest(other, new URL(other.url), deps)).toBeNull();
  });

  test("a missing or unknown token is refused", async () => {
    expect((await post({ text: "hi" }, null)).status).toBe(401);
    expect((await post({ text: "hi" }, "nonsense")).status).toBe(401);
    expect(delivered).toEqual([]);
  });

  test("whitespace-only and oversized text are refused before anything is spent", async () => {
    expect((await post({ text: "   " })).body.error.code).toBe("invalid_text");
    expect((await post({})).body.error.code).toBe("invalid_text");
    expect((await post({ text: "x".repeat(APP_MESSAGE_MAX_CHARS + 1) })).body.error.code).toBe("text_too_long");
    expect(delivered).toEqual([]);
  });

  test("an app nobody built has no target, and says so rather than picking one", async () => {
    const { status, body } = await post({ text: "hi" }, "tok-built-by-person");

    expect(status).toBe(409);
    expect(body.error.code).toBe("no_target");
    expect(delivered).toEqual([]);
  });

  test("a deleted app between token resolution and the read is a plain 404", async () => {
    deps.registry.remove("built-by-agent");

    expect((await post({ text: "hi" })).status).toBe(404);
  });

  test("a gone receiver is reported as target_gone, not as a bad parameter", async () => {
    sendResult = { ok: false, status: 404, code: "not_found", message: "agent not found" };

    const { status, body } = await post({ text: "hi" });

    expect(status).toBe(404);
    expect(body.error.code).toBe("target_gone");
  });

  test("the burst limit is spent per request and reports a retry hint", async () => {
    for (let i = 0; i < APP_MESSAGE_BURST_LIMIT; i++) {
      expect((await post({ text: `msg ${i}` })).status).toBe(200);
    }
    const { status, body } = await post({ text: "one too many" });

    expect(status).toBe(429);
    expect(body.error.code).toBe("rate_limited");
    expect(body.error.retryAfterSec).toBeGreaterThan(0);
    expect(delivered).toHaveLength(APP_MESSAGE_BURST_LIMIT);
  });

  test("a burst slot is spent even by a request that fails downstream", async () => {
    sendResult = { ok: false, status: 404, code: "not_found", message: "agent not found" };
    for (let i = 0; i < APP_MESSAGE_BURST_LIMIT; i++) {
      expect((await post({ text: "hi" })).status).toBe(404);
    }

    // The failures cost the app its burst budget: hammering a request that
    // always fails must not be free.
    expect((await post({ text: "hi" })).status).toBe(429);
  });

  test("the daily budget only moves on a delivery the receiver accepted", async () => {
    sendResult = { ok: false, status: 404, code: "not_found", message: "agent not found" };
    await post({ text: "hi" });
    // Advance past the burst window so only the daily budget could refuse.
    clock += 61_000;
    sendResult = { ok: true, messageId: "m2" };

    expect((await post({ text: "hi" })).status).toBe(200);
  });

  test("a queued delivery reports queued:true; an unknown queue state omits it", async () => {
    sendResult = { ok: true, messageId: "m1", queued: true };
    expect((await post({ text: "hi" })).body.queued).toBe(true);

    clock += 61_000;
    sendResult = { ok: true, messageId: "m1" };
    expect("queued" in (await post({ text: "hi" })).body).toBe(false);
  });
});
