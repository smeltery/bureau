import { describe, expect, test } from "bun:test";
import { DEFAULT_MEMBER_SHARE, validMemberShare } from "../../shared/member-usage/share.ts";
import { evaluateLine } from "./member-usage-cap.ts";
import { WEEK_MS } from "./office-usage.ts";

describe("member usage cap pacing", () => {
  test("member share accepts only 10 percent steps", () => {
    expect(validMemberShare(DEFAULT_MEMBER_SHARE)).toBe(true);
    expect(validMemberShare(10)).toBe(true);
    expect(validMemberShare(100)).toBe(true);
    expect(validMemberShare(0)).toBe(false);
    expect(validMemberShare(55)).toBe(false);
    expect(validMemberShare(110)).toBe(false);
  });

  test("opens one day of allowance at the start of each weekly day", () => {
    const weekStart = 1_000_000;
    const resetsAtMs = weekStart + WEEK_MS;
    const dayMs = WEEK_MS / 7;

    const dayOne = evaluateLine(10, resetsAtMs, weekStart, 70);
    expect(dayOne.allowed).toBe(false);
    expect(dayOne.linePercent).toBe(10);
    expect(dayOne.retryAtMs).toBe(weekStart + dayMs);

    const dayTwo = evaluateLine(10, resetsAtMs, weekStart + dayMs, 70);
    expect(dayTwo.allowed).toBe(true);
    expect(dayTwo.linePercent).toBe(20);
  });
});
