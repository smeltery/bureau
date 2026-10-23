import { expect, test } from "bun:test";
import { humanizeSchedule, type CronjobRun, type Schedule } from "../../../shared/types.ts";
import { lastRunTime, nextRunTime, runDuration, runStartedAt, runTrigger, scheduleDescription, weekdayLabel } from "./format.ts";

const languages = ["en", "es", "ca", "zh"] as const;

test("schedule descriptions retain server-local wall time and leave saved schedules unchanged", () => {
  const schedules: Schedule[] = [{ type: "manual" }, { type: "daily", hour: 0, minute: 5 }, { type: "weekly", weekday: 1, hour: 23, minute: 45 }, { type: "interval", minutes: 90 }];
  const original = JSON.stringify(schedules);
  for (const language of languages) {
    expect(scheduleDescription(schedules[1], language)).toContain("00:05");
    expect(scheduleDescription(schedules[2], language)).toContain("23:45");
    expect(scheduleDescription(schedules[2], language)).toContain(weekdayLabel(1, language));
    expect(scheduleDescription(schedules[3], language)).toContain("30");
  }
  expect(JSON.stringify(schedules)).toBe(original);
  expect(humanizeSchedule(schedules[2])).toBe("Weekly Mon at 23:45");
  expect(humanizeSchedule(schedules[3])).toBe("Every 1h30m");
  expect(scheduleDescription(schedules[0], "es")).toBe("Bajo demanda");
  expect(scheduleDescription(schedules[0], "zh")).toBe("按需");
});

test("run timestamps use the reader locale and preserve the timestamp", () => {
  const timestamp = new Date(2026, 0, 2, 16, 5).getTime();
  const now = new Date(2026, 0, 2, 23, 0).getTime();
  for (const language of languages) {
    expect(runStartedAt(timestamp, language, false, now)).toBe(new Intl.DateTimeFormat(language, { hour: "2-digit", minute: "2-digit" }).format(timestamp));
    expect(runStartedAt(timestamp, language, true, now)).toBe(new Intl.DateTimeFormat(language, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(timestamp));
    expect(runStartedAt(timestamp, language, false, now + 86400000)).toBe(runStartedAt(timestamp, language, true, now));
  }
});

test("duration and relative-time boundaries distinguish missing timestamps from epoch zero", () => {
  expect(runDuration(0, null, "es")).toBe("en curso…");
  expect(runDuration(0, 0, "en")).toBe("0s");
  expect(runDuration(0, 61000, "en")).toBe("1m 1s");
  expect(runDuration(0, 3661000, "en")).toBe("1h 1m");
  expect(runDuration(0, 61000, "zh")).toContain("分");
  expect(lastRunTime(null, "es", 100000)).toBe("—");
  expect(lastRunTime(0, "es", 60000)).toContain("1");
  expect(nextRunTime(0, "zh", 0)).toBe("随时");
  expect(nextRunTime(30000, "es", 0)).toBe("en menos de un minuto");
  expect(nextRunTime(90000, "en", 0)).toBe("in 1m");
});

test("trigger labels translate while member names and delivery identifiers stay literal", () => {
  const manual = { trigger: "manual", triggeredBy: "Original {member}" } as CronjobRun;
  const webhook = { trigger: "webhook", webhook: { hookId: "h", deliveryId: "Original {delivery}" } } as CronjobRun;
  expect(runTrigger(manual, "zh")).toBe("手动 · Original {member}");
  for (const language of languages) expect(runTrigger(webhook, language)).toContain("Original {delivery}");
});
