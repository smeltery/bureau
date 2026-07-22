import { beforeEach, describe, expect, test } from "bun:test";
import { _testResetReadyLimiter } from "../../ready-limiter.ts";
import { handleReadyRequest } from "../ready.ts";

beforeEach(() => _testResetReadyLimiter());

function server(address: string | null) {
  return {
    requestIP: () => (address ? { address, port: 12345, family: "IPv4" } : null),
  } as never;
}

describe("handleReadyRequest", () => {
  test("returns null for unrelated routes", () => {
    const req = new Request("http://local.test/api/version");

    expect(handleReadyRequest(req, new URL(req.url), { server: server("203.0.113.1"), now: () => 1000 })).toBeNull();
  });

  test("answers readiness without authentication", async () => {
    const req = new Request("http://local.test/readyz");

    const res = handleReadyRequest(req, new URL(req.url), { server: server("203.0.113.1"), now: () => 1000 });

    expect(res?.status).toBe(200);
    expect(await res?.json()).toEqual({ ok: true });
  });

  test("rate-limits repeated non-loopback probes", async () => {
    const req = new Request("http://local.test/readyz");
    const deps = { server: server("203.0.113.1"), now: () => 1000 };

    for (let i = 0; i < 30; i++) {
      expect(handleReadyRequest(req, new URL(req.url), deps)?.status).toBe(200);
    }
    const res = handleReadyRequest(req, new URL(req.url), deps);

    expect(res?.status).toBe(429);
    expect(await res?.json()).toEqual({ ok: false, error: "rate_limited" });
  });

  test("does not rate-limit loopback probes", () => {
    const req = new Request("http://local.test/readyz");
    const deps = { server: server("127.0.0.1"), now: () => 1000 };

    for (let i = 0; i < 40; i++) {
      expect(handleReadyRequest(req, new URL(req.url), deps)?.status).toBe(200);
    }
  });
});
