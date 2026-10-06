// Pure scheduler math. No filesystem reads, no SDK imports — kept side-effect
// free so tests can import this module without bringing in `agents/state.ts`
// (which loads office config from disk on import) or the Agent SDK.
import type { Schedule } from "../../shared/types.ts";

export const MIN_INTERVAL_MINUTES = 5;

export function computeNextFire(schedule: Exclude<Schedule, { type: "manual" }>, anchor: number, now?: number): number;
export function computeNextFire(schedule: Schedule, anchor: number, now?: number): number | null;
export function computeNextFire(schedule: Schedule, anchor: number, now: number = Date.now()): number | null {
  if (schedule.type === "manual") return null;
  if (schedule.type === "interval") {
    const intervalMs = Math.max(MIN_INTERVAL_MINUTES, schedule.minutes) * 60_000;
    if (now <= anchor) return anchor + intervalMs;
    const elapsed = now - anchor;
    // floor + 1 (not ceil): when elapsed lands exactly on a period boundary,
    // ceil(N) = N gives nextFireAt == now and the scheduler fires immediately.
    // floor(N) + 1 always returns the *next* future period.
    const periods = Math.floor(elapsed / intervalMs) + 1;
    return anchor + periods * intervalMs;
  }
  if (schedule.type === "daily") {
    const next = new Date(now);
    next.setSeconds(0, 0);
    next.setHours(schedule.hour, schedule.minute, 0, 0);
    if (next.getTime() <= now) next.setDate(next.getDate() + 1);
    return next.getTime();
  }
  // weekly
  const next = new Date(now);
  next.setSeconds(0, 0);
  next.setHours(schedule.hour, schedule.minute, 0, 0);
  const currentDay = next.getDay();
  let daysAhead = (schedule.weekday - currentDay + 7) % 7;
  if (daysAhead === 0 && next.getTime() <= now) daysAhead = 7;
  next.setDate(next.getDate() + daysAhead);
  return next.getTime();
}

export function clampSchedule(schedule: Schedule): Schedule {
  if (schedule.type === "manual") return { type: "manual" };
  if (schedule.type === "interval") {
    return {
      type: "interval",
      minutes: Math.max(MIN_INTERVAL_MINUTES, Math.floor(schedule.minutes)),
    };
  }
  if (schedule.type === "daily") {
    return {
      type: "daily",
      hour: Math.min(23, Math.max(0, Math.floor(schedule.hour))),
      minute: Math.min(59, Math.max(0, Math.floor(schedule.minute))),
    };
  }
  return {
    type: "weekly",
    weekday: Math.min(6, Math.max(0, Math.floor(schedule.weekday))) as 0 | 1 | 2 | 3 | 4 | 5 | 6,
    hour: Math.min(23, Math.max(0, Math.floor(schedule.hour))),
    minute: Math.min(59, Math.max(0, Math.floor(schedule.minute))),
  };
}
