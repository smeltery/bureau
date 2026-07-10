import type { Cronjob, Schedule } from "../shared/types.ts";
import { generateCronjobId } from "../shared/types.ts";
import { DEMO_CRONJOBS_SEED } from "./demo-fixtures.ts";

export const cronjobs: Cronjob[] = [];
export let cronjobsPrompt: string | null = null;

export function setCronjobsPrompt(value: string | null) {
  cronjobsPrompt = value && value.trim() ? value : null;
  return cronjobsPrompt;
}

export function computeNextFireDemo(schedule: Schedule, anchor: number, now: number = Date.now()): number {
  if (schedule.type === "interval") {
    const intervalMs = Math.max(5, schedule.minutes) * 60_000;
    if (now <= anchor) return anchor + intervalMs;
    const periods = Math.floor((now - anchor) / intervalMs) + 1;
    return anchor + periods * intervalMs;
  }
  const next = new Date(now);
  next.setSeconds(0, 0);
  next.setHours(schedule.hour, schedule.minute, 0, 0);
  if (schedule.type === "daily") {
    if (next.getTime() <= now) next.setDate(next.getDate() + 1);
    return next.getTime();
  }
  const currentDay = next.getDay();
  let daysAhead = (schedule.weekday - currentDay + 7) % 7;
  if (daysAhead === 0 && next.getTime() <= now) daysAhead = 7;
  next.setDate(next.getDate() + daysAhead);
  return next.getTime();
}

export function seedCronjobs() {
  const now = Date.now();
  const usedIds = new Set<string>();
  for (const seed of DEMO_CRONJOBS_SEED) {
    const id = generateCronjobId(Array.from(usedIds));
    usedIds.add(id);
    const createdAt = now - seed.ageDays * 86400000;
    const lastFireAt = seed.lastFireDaysAgo === null ? null : now - seed.lastFireDaysAgo * 86400000;
    cronjobs.push({
      id,
      name: seed.name,
      schedule: seed.schedule,
      prompt: seed.prompt,
      cwd: seed.cwd,
      modelFamily: seed.modelFamily,
      permissionMode: "bypassPermissions",
      enabled: true,
      createdBy: seed.createdBy,
      device: null,
      createdAt,
      lastFireAt,
      nextFireAt: computeNextFireDemo(seed.schedule, lastFireAt ?? createdAt, now),
    });
  }
}
