import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { ESCALATION_AMBER_MS, ESCALATION_RED_MS, escalationColor, formatDuration, formatElapsed, timeAgo } from "../time.ts";

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

describe("formatElapsed (integer seconds)", () => {
  test("under a minute, prints seconds with the s suffix", () => {
    expect(formatElapsed(0)).toBe("0s");
    expect(formatElapsed(999)).toBe("0s");
    expect(formatElapsed(12_345)).toBe("12s");
    expect(formatElapsed(59_999)).toBe("59s");
  });

  test("at and above a minute, prints M:SS", () => {
    expect(formatElapsed(60_000)).toBe("1:00");
    expect(formatElapsed(83_000)).toBe("1:23");
    expect(formatElapsed(3_600_000)).toBe("60:00");
  });
});

describe("formatDuration (fractional seconds)", () => {
  test("under a minute, prints fractional seconds with one decimal", () => {
    expect(formatDuration(0)).toBe("0.0s");
    expect(formatDuration(1234)).toBe("1.2s");
    expect(formatDuration(59_900)).toBe("59.9s");
  });

  test("at and above a minute, prints M:SS without decimals", () => {
    expect(formatDuration(60_000)).toBe("1:00");
    expect(formatDuration(125_000)).toBe("2:05");
  });
});

describe("timeAgo", () => {
  // Pin Date.now to keep the assertions stable across CI clock noise.
  const FROZEN = 1_700_000_000_000;
  const realNow = Date.now;
  beforeEach(() => {
    Date.now = () => FROZEN;
  });
  afterEach(() => {
    Date.now = realNow;
  });

  test("returns 'just now' under one minute", () => {
    expect(timeAgo(FROZEN - 1000)).toBe("just now");
    expect(timeAgo(FROZEN - 30_000)).toBe("just now");
  });

  test("formats minutes for sub-hour ages", () => {
    expect(timeAgo(FROZEN - 5 * MIN)).toBe("5m ago");
    expect(timeAgo(FROZEN - 59 * MIN)).toBe("59m ago");
  });

  test("formats hours for sub-day ages", () => {
    expect(timeAgo(FROZEN - 1 * HOUR)).toBe("1h ago");
    expect(timeAgo(FROZEN - 23 * HOUR)).toBe("23h ago");
  });

  test("formats days beyond a day", () => {
    expect(timeAgo(FROZEN - 1 * DAY)).toBe("1d ago");
    expect(timeAgo(FROZEN - 7 * DAY)).toBe("7d ago");
  });
});

describe("escalationColor", () => {
  const BASE = "var(--green)";

  test("returns the base color before the amber threshold", () => {
    expect(escalationColor(0, BASE)).toBe(BASE);
    expect(escalationColor(ESCALATION_AMBER_MS - 1, BASE)).toBe(BASE);
  });

  test("returns amber once at or past the amber threshold", () => {
    expect(escalationColor(ESCALATION_AMBER_MS, BASE)).toBe("var(--orange)");
    expect(escalationColor(ESCALATION_RED_MS - 1, BASE)).toBe("var(--orange)");
  });

  test("returns red once at or past the red threshold", () => {
    expect(escalationColor(ESCALATION_RED_MS, BASE)).toBe("var(--red)");
    expect(escalationColor(ESCALATION_RED_MS * 2, BASE)).toBe("var(--red)");
  });

  test("amber threshold is 2 minutes; red is 5 minutes", () => {
    expect(ESCALATION_AMBER_MS).toBe(2 * MIN);
    expect(ESCALATION_RED_MS).toBe(5 * MIN);
  });
});
