import { afterEach, describe, expect, test } from "bun:test";
import { _testResetAuthRateLimits, checkAuthRateLimit } from "./auth-rate-limit.ts";

afterEach(() => {
  _testResetAuthRateLimits();
});

function request(ip = "203.0.113.10"): Request {
  return new Request("http://local.test/i/token", {
    headers: { "X-Forwarded-For": ip },
  });
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
