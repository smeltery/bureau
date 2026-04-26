import { describe, expect, test } from "bun:test";
import { MIN_INTERVAL_MINUTES, clampSchedule, computeNextFire } from "../schedule.ts";
import type { Schedule } from "../../../shared/types.ts";

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

describe("computeNextFire — interval", () => {
  test("returns anchor + period when now is at or before anchor", () => {
    const anchor = 1_000_000_000_000;
    const out = computeNextFire({ type: "interval", minutes: 10 }, anchor, anchor);
    expect(out).toBe(anchor + 10 * MIN);
  });

  test("on an exact period boundary, returns the next future period (floor + 1, not ceil)", () => {
    // The motivating bug: ceil(elapsed/period) on an exact boundary returns
    // a value equal to `now`, which made the scheduler fire immediately. The
    // floor+1 form must always return a *future* instant.
    const anchor = 1_000_000_000_000;
    const period = 5;
    const now = anchor + period * MIN; // exactly one period later
    const out = computeNextFire({ type: "interval", minutes: period }, anchor, now);
    expect(out).toBeGreaterThan(now);
    expect(out).toBe(anchor + 2 * period * MIN);
  });

  test("mid-period now returns the next period boundary", () => {
    const anchor = 1_000_000_000_000;
    const period = 10;
    const now = anchor + 3 * MIN; // 3 minutes into a 10-minute period
    const out = computeNextFire({ type: "interval", minutes: period }, anchor, now);
    expect(out).toBe(anchor + period * MIN);
  });

  test("after several missed periods, returns the *next* future boundary, not the catch-up", () => {
    const anchor = 1_000_000_000_000;
    const period = 5;
    const now = anchor + 17 * MIN; // 3 full periods elapsed + 2min into the 4th
    const out = computeNextFire({ type: "interval", minutes: period }, anchor, now);
    expect(out).toBeGreaterThan(now);
    expect(out).toBe(anchor + 4 * period * MIN); // 20 minutes after anchor
  });

  test("enforces the 5-minute floor on interval", () => {
    const anchor = 1_000_000_000_000;
    // Pass an under-minimum period; computeNextFire silently clamps for math.
    const out = computeNextFire({ type: "interval", minutes: 1 }, anchor, anchor);
    expect(out).toBe(anchor + MIN_INTERVAL_MINUTES * MIN);
  });
});

describe("computeNextFire — daily", () => {
  test("returns later today when target hour is in the future", () => {
    const noonToday = new Date(2026, 0, 15, 12, 0, 0, 0).getTime();
    const out = computeNextFire({ type: "daily", hour: 18, minute: 30 }, noonToday, noonToday);
    expect(new Date(out).getHours()).toBe(18);
    expect(new Date(out).getMinutes()).toBe(30);
    expect(out - noonToday).toBe(6 * HOUR + 30 * MIN);
  });

  test("rolls to tomorrow when target time has already passed today", () => {
    const lateToday = new Date(2026, 0, 15, 22, 0, 0, 0).getTime();
    const out = computeNextFire({ type: "daily", hour: 9, minute: 0 }, lateToday, lateToday);
    expect(out).toBeGreaterThan(lateToday);
    // 9am tomorrow = 11 hours from 10pm today
    expect(out - lateToday).toBe(11 * HOUR);
  });

  test("at exactly the target instant, rolls to tomorrow", () => {
    const nineToday = new Date(2026, 0, 15, 9, 0, 0, 0).getTime();
    const out = computeNextFire({ type: "daily", hour: 9, minute: 0 }, nineToday, nineToday);
    expect(out - nineToday).toBe(DAY);
  });
});

describe("computeNextFire — weekly", () => {
  test("returns later in the week when weekday is ahead", () => {
    // Thursday 2026-01-15 at noon. Target: Saturday at 09:00 (weekday 6).
    const thursday = new Date(2026, 0, 15, 12, 0, 0, 0).getTime();
    const out = computeNextFire({ type: "weekly", weekday: 6, hour: 9, minute: 0 }, thursday, thursday);
    const outDate = new Date(out);
    expect(outDate.getDay()).toBe(6);
    expect(outDate.getHours()).toBe(9);
    expect(outDate.getMinutes()).toBe(0);
    // Thursday → Saturday morning is roughly 1d + 21h
    expect(out - thursday).toBe(DAY + 21 * HOUR);
  });

  test("rolls to next week when target weekday already passed today", () => {
    // Saturday 2026-01-17 at 18:00. Target: Saturday at 09:00.
    const saturdayEvening = new Date(2026, 0, 17, 18, 0, 0, 0).getTime();
    const out = computeNextFire({ type: "weekly", weekday: 6, hour: 9, minute: 0 }, saturdayEvening, saturdayEvening);
    expect(out).toBeGreaterThan(saturdayEvening);
    expect(new Date(out).getDay()).toBe(6);
    expect(out - saturdayEvening).toBe(7 * DAY - 9 * HOUR);
  });

  test("at exactly the target weekday/time, rolls to next week", () => {
    const targetSat = new Date(2026, 0, 17, 9, 0, 0, 0).getTime();
    const out = computeNextFire({ type: "weekly", weekday: 6, hour: 9, minute: 0 }, targetSat, targetSat);
    expect(out - targetSat).toBe(7 * DAY);
  });
});

describe("clampSchedule", () => {
  test("clamps interval to the 5-minute minimum", () => {
    const out = clampSchedule({ type: "interval", minutes: 1 });
    expect(out).toEqual({ type: "interval", minutes: 5 });
  });

  test("floors fractional interval minutes", () => {
    const out = clampSchedule({ type: "interval", minutes: 12.7 });
    expect(out).toEqual({ type: "interval", minutes: 12 });
  });

  test("clamps daily hour to [0,23] and minute to [0,59]", () => {
    const high = clampSchedule({ type: "daily", hour: 99, minute: 99 });
    expect(high).toEqual({ type: "daily", hour: 23, minute: 59 });
    const low = clampSchedule({ type: "daily", hour: -5, minute: -1 });
    expect(low).toEqual({ type: "daily", hour: 0, minute: 0 });
  });

  test("clamps weekly weekday to [0,6]", () => {
    const high = clampSchedule({ type: "weekly", weekday: 99 as 0, hour: 9, minute: 0 });
    expect((high as Schedule & { weekday: number }).weekday).toBe(6);
    const low = clampSchedule({ type: "weekly", weekday: -3 as 0, hour: 9, minute: 0 });
    expect((low as Schedule & { weekday: number }).weekday).toBe(0);
  });

  test("preserves a valid daily schedule unchanged", () => {
    const sched: Schedule = { type: "daily", hour: 9, minute: 30 };
    expect(clampSchedule(sched)).toEqual(sched);
  });
});
