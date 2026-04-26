import { describe, expect, test } from "bun:test";
import { addBucket, emptyBucket, formatInCell, formatRelativeTime, formatTokenCount, formatUsd, type UsageBucket } from "../usage-format.ts";

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

describe("emptyBucket / addBucket", () => {
  test("emptyBucket returns all zeros", () => {
    expect(emptyBucket()).toEqual({ totalIn: 0, cacheRead: 0, cacheCreation: 0, totalOut: 0, costUSD: 0 });
  });

  test("emptyBucket returns a fresh object each call", () => {
    const a = emptyBucket();
    const b = emptyBucket();
    a.totalIn = 99;
    expect(b.totalIn).toBe(0);
  });

  test("addBucket mutates the destination in place", () => {
    const dst = emptyBucket();
    const src: UsageBucket = { totalIn: 10, cacheRead: 4, cacheCreation: 2, totalOut: 3, costUSD: 0.5 };
    addBucket(dst, src);
    expect(dst).toEqual(src);
  });

  test("addBucket accumulates over multiple calls", () => {
    const dst = emptyBucket();
    addBucket(dst, { totalIn: 1, cacheRead: 1, cacheCreation: 0, totalOut: 1, costUSD: 0.25 });
    addBucket(dst, { totalIn: 2, cacheRead: 2, cacheCreation: 0, totalOut: 2, costUSD: 0.25 });
    expect(dst).toEqual({ totalIn: 3, cacheRead: 3, cacheCreation: 0, totalOut: 3, costUSD: 0.5 });
  });
});

describe("formatTokenCount", () => {
  test("zero renders as an em-dash", () => {
    expect(formatTokenCount(0)).toBe("—");
  });

  test("sub-1000 renders as a localized integer", () => {
    expect(formatTokenCount(1)).toBe("1");
    expect(formatTokenCount(999)).toBe("999");
  });

  test("1000–999_499 renders with a k suffix and no decimals", () => {
    expect(formatTokenCount(1000)).toBe("1k");
    expect(formatTokenCount(12_345)).toBe("12k");
    expect(formatTokenCount(999_499)).toBe("999k");
  });

  test("the 999_500 / 1M boundary promotes to 'M' to avoid the '1000k' artifact", () => {
    expect(formatTokenCount(999_500)).toBe("1.0M");
    expect(formatTokenCount(1_000_000)).toBe("1.0M");
    expect(formatTokenCount(1_500_000)).toBe("1.5M");
  });
});

describe("formatUsd", () => {
  test("zero renders as an em-dash", () => {
    expect(formatUsd(0)).toBe("—");
  });

  test("under $100 keeps two decimals", () => {
    expect(formatUsd(0.01)).toBe("$0.01");
    expect(formatUsd(1.23)).toBe("$1.23");
    expect(formatUsd(99.99)).toBe("$99.99");
  });

  test("at and above $100 drops decimals (rounded)", () => {
    expect(formatUsd(100)).toBe("$100");
    expect(formatUsd(123.45)).toBe("$123");
    expect(formatUsd(999.5)).toBe("$1000");
  });
});

describe("formatInCell", () => {
  test("totalIn=0 renders as em-dash", () => {
    expect(formatInCell({ totalIn: 0, cacheRead: 0, cacheCreation: 0, totalOut: 0, costUSD: 0 })).toBe("—");
  });

  test("when nothing is cacheable, just shows the formatted total", () => {
    expect(formatInCell({ totalIn: 1234, cacheRead: 0, cacheCreation: 0, totalOut: 0, costUSD: 0 })).toBe("1k");
  });

  test("hides the (N% hit) suffix at and above the 80% threshold", () => {
    // 80/100 = 80% ⇒ suppressed.
    expect(formatInCell({ totalIn: 1500, cacheRead: 80, cacheCreation: 20, totalOut: 0, costUSD: 0 })).toBe("2k");
    // 90% ⇒ suppressed.
    expect(formatInCell({ totalIn: 1500, cacheRead: 90, cacheCreation: 10, totalOut: 0, costUSD: 0 })).toBe("2k");
  });

  test("shows the (N% hit) suffix below 80% (cache-thrash canary)", () => {
    // 50% hit rate.
    expect(formatInCell({ totalIn: 1500, cacheRead: 50, cacheCreation: 50, totalOut: 0, costUSD: 0 })).toBe("2k (50% hit)");
    // 0% hit (rare but possible: all writes, no reads).
    expect(formatInCell({ totalIn: 1000, cacheRead: 0, cacheCreation: 100, totalOut: 0, costUSD: 0 })).toBe("1k (0% hit)");
  });
});

describe("formatRelativeTime", () => {
  // Pin "now" so assertions are stable.
  const NOW = 1_700_000_000_000;

  test("returns 'just now' for sub-minute deltas", () => {
    expect(formatRelativeTime(NOW - 5_000, NOW)).toBe("just now");
    expect(formatRelativeTime(NOW, NOW)).toBe("just now");
  });

  test("renders minutes for sub-hour deltas", () => {
    expect(formatRelativeTime(NOW - 1 * MIN, NOW)).toBe("1m ago");
    expect(formatRelativeTime(NOW - 59 * MIN, NOW)).toBe("59m ago");
  });

  test("renders hours for sub-day deltas", () => {
    expect(formatRelativeTime(NOW - 1 * HOUR, NOW)).toBe("1h ago");
    expect(formatRelativeTime(NOW - 23 * HOUR, NOW)).toBe("23h ago");
  });

  test("renders days for sub-week deltas", () => {
    expect(formatRelativeTime(NOW - 1 * DAY, NOW)).toBe("1d ago");
    expect(formatRelativeTime(NOW - 6 * DAY, NOW)).toBe("6d ago");
  });

  test("falls back to a 'Mon D' calendar date once a week has passed", () => {
    const out = formatRelativeTime(NOW - 8 * DAY, NOW);
    // Locale-specific output, but the format always has at least a month
    // abbreviation and a number — match loosely on that contract.
    expect(out).toMatch(/[A-Za-z]/);
    expect(out).toMatch(/\d/);
    expect(out).not.toMatch(/ago/);
  });
});
