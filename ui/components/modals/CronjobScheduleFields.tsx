import { useI18n } from "../../i18n.tsx";
import { weekdayLabel } from "../schedules/format.ts";
import type { Schedule } from "../../../shared/types.ts";

export type ScheduleType = Schedule["type"];

export function clampScheduleNumber(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

export function parseIntOr(s: string, fallback: number): number {
  const n = parseInt(s, 10);
  return Number.isFinite(n) ? n : fallback;
}

export function buildCronjobSchedule({
  scheduleType,
  hourStr,
  minuteStr,
  weekday,
  intervalStr,
}: {
  scheduleType: ScheduleType;
  hourStr: string;
  minuteStr: string;
  weekday: 0 | 1 | 2 | 3 | 4 | 5 | 6;
  intervalStr: string;
}): Schedule {
  if (scheduleType === "manual") return { type: "manual" };
  const hour = clampScheduleNumber(parseIntOr(hourStr, 0), 0, 23);
  const minute = clampScheduleNumber(parseIntOr(minuteStr, 0), 0, 59);
  const intervalMinutes = Math.max(5, parseIntOr(intervalStr, 5));
  if (scheduleType === "daily") return { type: "daily", hour, minute };
  if (scheduleType === "weekly") return { type: "weekly", weekday, hour, minute };
  return { type: "interval", minutes: intervalMinutes };
}

export function CronjobScheduleFields({
  scheduleType,
  setScheduleType,
  weekday,
  setWeekday,
  hourStr,
  setHourStr,
  minuteStr,
  setMinuteStr,
  intervalStr,
  setIntervalStr,
  labelStyle,
  inputStyle,
}: {
  scheduleType: ScheduleType;
  setScheduleType: (value: ScheduleType) => void;
  weekday: 0 | 1 | 2 | 3 | 4 | 5 | 6;
  setWeekday: (value: 0 | 1 | 2 | 3 | 4 | 5 | 6) => void;
  hourStr: string;
  setHourStr: (value: string) => void;
  minuteStr: string;
  setMinuteStr: (value: string) => void;
  intervalStr: string;
  setIntervalStr: (value: string) => void;
  labelStyle: React.CSSProperties;
  inputStyle: React.CSSProperties;
}) {
  const { t, language } = useI18n();
  return (
    <>
      <label style={{ ...labelStyle, marginTop: 14 }}>{t("schedules.column.schedule")}</label>
      <select value={scheduleType} onChange={(e) => setScheduleType(e.target.value as ScheduleType)} style={{ ...inputStyle, appearance: "none", cursor: "pointer", marginBottom: 6 }}>
        <option value="manual">{t("schedules.manual")}</option>
        <option value="daily">{t("schedules.daily")}</option>
        <option value="weekly">{t("schedules.weekly")}</option>
        <option value="interval">{t("schedules.interval")}</option>
      </select>
      {scheduleType === "weekly" && (
        <select
          value={weekday}
          onChange={(e) => setWeekday(parseInt(e.target.value, 10) as 0 | 1 | 2 | 3 | 4 | 5 | 6)}
          style={{ ...inputStyle, appearance: "none", cursor: "pointer", marginBottom: 6 }}
        >
          {([0, 1, 2, 3, 4, 5, 6] as const).map((day) => (
            <option key={day} value={day}>
              {weekdayLabel(day, language, "long")}
            </option>
          ))}
        </select>
      )}
      {(scheduleType === "daily" || scheduleType === "weekly") && (
        <div style={{ display: "flex", gap: 8 }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 10, color: "var(--text-muted)", marginBottom: 4 }}>{t("schedules.hour")}</div>
            <input
              type="number"
              min={0}
              max={23}
              value={hourStr}
              onChange={(e) => setHourStr(e.target.value)}
              onBlur={() => setHourStr(String(clampScheduleNumber(parseIntOr(hourStr, 0), 0, 23)))}
              style={inputStyle}
            />
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 10, color: "var(--text-muted)", marginBottom: 4 }}>{t("schedules.minute")}</div>
            <input
              type="number"
              min={0}
              max={59}
              value={minuteStr}
              onChange={(e) => setMinuteStr(e.target.value)}
              onBlur={() => setMinuteStr(String(clampScheduleNumber(parseIntOr(minuteStr, 0), 0, 59)))}
              style={inputStyle}
            />
          </div>
        </div>
      )}
      {scheduleType === "interval" && (
        <div>
          <div style={{ fontSize: 10, color: "var(--text-muted)", marginBottom: 4 }}>{t("schedules.intervalMinutes")}</div>
          <input
            type="number"
            min={5}
            value={intervalStr}
            onChange={(e) => setIntervalStr(e.target.value)}
            onBlur={() => setIntervalStr(String(Math.max(5, parseIntOr(intervalStr, 5))))}
            style={inputStyle}
          />
        </div>
      )}
      <p style={{ fontSize: 10, color: "var(--text-ghost)", margin: "6px 0 0" }}>{scheduleType === "manual" ? t("schedules.manualHint") : t("schedules.serverLocal")}</p>
    </>
  );
}
