import type { CronjobRun, Schedule } from "../../../shared/types.ts";
import type { SupportedLanguageCode } from "../../../shared/languages.ts";
import { translatorFor } from "../../../shared/i18n/translate.ts";

function unit(value: number, name: "second" | "minute" | "hour" | "day", language: SupportedLanguageCode): string {
  return new Intl.NumberFormat(language, { style: "unit", unit: name, unitDisplay: "narrow", useGrouping: false }).format(value);
}

export function weekdayLabel(day: number, language: SupportedLanguageCode, weekday: "short" | "long" = "short"): string {
  return new Intl.DateTimeFormat(language, { weekday, timeZone: "UTC" }).format(new Date(Date.UTC(2024, 0, 7 + day)));
}

export function scheduleDescription(schedule: Schedule, language: SupportedLanguageCode): string {
  const { t } = translatorFor(language);
  if (schedule.type === "manual") return t("schedules.manual");
  if (schedule.type === "interval") {
    const minutes = schedule.minutes;
    const duration =
      minutes < 60 ? unit(minutes, "minute", language) : [unit(Math.floor(minutes / 60), "hour", language), minutes % 60 ? unit(minutes % 60, "minute", language) : ""].filter(Boolean).join(" ");
    return t("schedules.every", { duration });
  }
  // The saved wall-clock fields refer to the server timezone. A UTC reference
  // formats those fields without converting them to the reader's timezone.
  const time = new Intl.DateTimeFormat(language, { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: "UTC" }).format(new Date(Date.UTC(2024, 0, 7, schedule.hour, schedule.minute)));
  return schedule.type === "daily" ? t("schedules.dailyAt", { time }) : t("schedules.weeklyAt", { day: weekdayLabel(schedule.weekday, language), time });
}

export function runDuration(start: number, end: number | null, language: SupportedLanguageCode): string {
  if (end === null) return translatorFor(language).t("schedules.running");
  const seconds = Math.max(0, Math.floor((end - start) / 1000));
  if (seconds < 60) return unit(seconds, "second", language);
  const minutes = Math.floor(seconds / 60);
  return minutes < 60
    ? `${unit(minutes, "minute", language)} ${unit(seconds % 60, "second", language)}`
    : `${unit(Math.floor(minutes / 60), "hour", language)} ${unit(minutes % 60, "minute", language)}`;
}

export function runStartedAt(timestamp: number, language: SupportedLanguageCode, full = false, now = Date.now()): string {
  const date = new Date(timestamp);
  const sameDay = date.toDateString() === new Date(now).toDateString();
  return new Intl.DateTimeFormat(language, { ...((full || !sameDay) && { month: "short", day: "numeric" }), hour: "2-digit", minute: "2-digit" }).format(date);
}

export function runTrigger(run: CronjobRun, language: SupportedLanguageCode): string {
  const label = translatorFor(language).t(`schedules.trigger.${run.trigger}`);
  const detail = run.trigger === "manual" ? run.triggeredBy : run.trigger === "webhook" ? (run.webhook?.deliveryId ?? run.triggeredBy) : undefined;
  return detail ? `${label} · ${detail}` : label;
}

export function lastRunTime(timestamp: number | null, language: SupportedLanguageCode, now = Date.now()): string {
  if (timestamp === null) return "—";
  const minutes = Math.floor((now - timestamp) / 60_000);
  if (minutes < 1) return translatorFor(language).t("common.justNow");
  const hours = Math.floor(minutes / 60);
  return new Intl.RelativeTimeFormat(language, { numeric: "always", style: "short" }).format(
    minutes < 60 ? -minutes : hours < 24 ? -hours : -Math.floor(hours / 24),
    minutes < 60 ? "minute" : hours < 24 ? "hour" : "day",
  );
}

export function nextRunTime(timestamp: number, language: SupportedLanguageCode, now = Date.now()): string {
  const { t } = translatorFor(language);
  if (timestamp <= now) return t("schedules.soon");
  const minutes = Math.floor((timestamp - now) / 60_000);
  const hours = Math.floor(minutes / 60);
  const duration =
    minutes < 1
      ? t("schedules.underMinute")
      : minutes < 60
        ? unit(minutes, "minute", language)
        : hours < 24
          ? [unit(hours, "hour", language), minutes % 60 ? unit(minutes % 60, "minute", language) : ""].filter(Boolean).join(" ")
          : `${unit(Math.floor(hours / 24), "day", language)} ${unit(hours % 24, "hour", language)}`;
  return t("schedules.in", { duration });
}
