import { beforeEach, describe, expect, test } from "bun:test";
import { _testResetReadyLimiter, allowReadyRequest } from "./ready-limiter.ts";

beforeEach(() => _testResetReadyLimiter());

describe("allowReadyRequest", () => {
  test("allows up to thirty requests per window", () => {
    for (let i = 0; i < 30; i++) {
      expect(allowReadyRequest("203.0.113.1", 1000)).toBe(true);
    }

    expect(allowReadyRequest("203.0.113.1", 1000)).toBe(false);
  });

  test("resets counts after the window expires", () => {
    for (let i = 0; i < 31; i++) allowReadyRequest("203.0.113.1", 1000);

    expect(allowReadyRequest("203.0.113.1", 1000)).toBe(false);
    expect(allowReadyRequest("203.0.113.1", 61_000)).toBe(true);
  });

  test("tracks client IPs independently", () => {
    for (let i = 0; i < 31; i++) allowReadyRequest("203.0.113.1", 1000);

    expect(allowReadyRequest("203.0.113.1", 1000)).toBe(false);
    expect(allowReadyRequest("203.0.113.2", 1000)).toBe(true);
  });

  test("evicts expired windows when the map is full", () => {
    for (let i = 0; i < 1024; i++) {
      allowReadyRequest(`203.0.${i >> 8}.${i & 255}`, 1000);
    }

    expect(allowReadyRequest("198.51.100.1", 61_000)).toBe(true);
    for (let i = 0; i < 29; i++) allowReadyRequest("198.51.100.1", 61_000);
    expect(allowReadyRequest("198.51.100.1", 61_000)).toBe(false);
  });

  test("fails open when the map is full of live windows", () => {
    for (let i = 0; i < 1024; i++) {
      allowReadyRequest(`203.0.${i >> 8}.${i & 255}`, 1000);
    }

    for (let i = 0; i < 40; i++) {
      expect(allowReadyRequest("198.51.100.1", 1000)).toBe(true);
    }
  });
});
