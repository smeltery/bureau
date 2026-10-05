import { afterEach, describe, expect, test } from "bun:test";
import { _testResetAuthRateLimits, checkAuthRateLimit } from "./auth-rate-limit.ts";
import { requestSource, trustedProxy } from "./auth-request-guards.ts";

afterEach(() => {
  _testResetAuthRateLimits();
});

function request(ip = "203.0.113.10"): string {
  return ip;
}

describe("auth rate limiting", () => {
  test("allows ten invite peeks per client per minute", () => {
    const req = request();
    for (let i = 0; i < 10; i += 1) {
      expect(checkAuthRateLimit(req, "invite_peek", 1_000)).toBeNull();
    }

    const limited = checkAuthRateLimit(req, "invite_peek", 1_000);

    expect(limited?.status).toBe(429);
    expect(limited?.headers.get("Retry-After")).toBe("60");
  });

  test("allows five invite accepts per client per minute", () => {
    const req = request();
    for (let i = 0; i < 5; i += 1) {
      expect(checkAuthRateLimit(req, "invite_accept", 1_000)).toBeNull();
    }

    expect(checkAuthRateLimit(req, "invite_accept", 1_000)?.status).toBe(429);
  });

  test("tracks clients independently and resets after the window", () => {
    const first = request("203.0.113.10");
    const second = request("203.0.113.11");
    for (let i = 0; i < 10; i += 1) {
      expect(checkAuthRateLimit(first, "invite_peek", 1_000)).toBeNull();
    }

    expect(checkAuthRateLimit(first, "invite_peek", 1_000)?.status).toBe(429);
    expect(checkAuthRateLimit(second, "invite_peek", 1_000)).toBeNull();
    expect(checkAuthRateLimit(first, "invite_peek", 61_000)).toBeNull();
  });
});

describe("requestSource", () => {
  const relayed = (xff: string) => new Request("http://local.test/i/token", { headers: { "X-Forwarded-For": xff } });

  test("ignores forwarding headers unless a proxy is declared", () => {
    expect(requestSource(relayed("198.51.100.1"), "203.0.113.10", "none")).toEqual({ onBox: false, client: "203.0.113.10" });
    expect(requestSource(relayed("198.51.100.1"), "127.0.0.1", "none")).toEqual({ onBox: false, client: "127.0.0.1" });
  });

  test("keys on the entry the declared proxy wrote, not one the client sent", () => {
    expect(requestSource(relayed("6.6.6.6, 198.51.100.1"), "127.0.0.1", "same-host").client).toBe("198.51.100.1");
    expect(requestSource(relayed("6.6.6.6, 198.51.100.2"), "10.0.0.9", "load-balancer").client).toBe("198.51.100.2");
    // A direct off-box caller can't pick its key by sending the header.
    expect(requestSource(relayed("6.6.6.6"), "203.0.113.10", "same-host").client).toBe("203.0.113.10");
    expect(requestSource(relayed("6.6.6.6"), "127.0.0.1", "load-balancer").client).toBe("127.0.0.1");
  });

  test("only a header-free loopback request is on-box", () => {
    expect(requestSource(new Request("http://local.test/"), "::1", "same-host").onBox).toBe(true);
    expect(requestSource(relayed("198.51.100.1"), "127.0.0.1", "same-host").onBox).toBe(false);
    expect(requestSource(new Request("http://local.test/"), null, "none")).toEqual({ onBox: false, client: "unknown" });
  });

  test("falls back to none on an unknown BUREAU_TRUSTED_PROXY value", () => {
    expect(trustedProxy(undefined)).toBe("none");
    expect(trustedProxy("same-host")).toBe("same-host");
    expect(trustedProxy("caddy")).toBe("none");
  });
});
