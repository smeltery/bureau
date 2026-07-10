import type { Schedule } from "../../../shared/types.ts";

const WEEKDAYS: { value: 0 | 1 | 2 | 3 | 4 | 5 | 6; label: string }[] = [
  { value: 0, label: "Sunday" },
  { value: 1, label: "Monday" },
  { value: 2, label: "Tuesday" },
  { value: 3, label: "Wednesday" },
  { value: 4, label: "Thursday" },
  { value: 5, label: "Friday" },
  { value: 6, label: "Saturday" },
];

export type ScheduleType = "daily" | "weekly" | "interval";

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
  return (
    <>
      <label style={{ ...labelStyle, marginTop: 14 }}>Schedule</label>
      <select value={scheduleType} onChange={(e) => setScheduleType(e.target.value as ScheduleType)} style={{ ...inputStyle, appearance: "none", cursor: "pointer", marginBottom: 6 }}>
        <option value="daily">Daily</option>
        <option value="weekly">Weekly</option>
        <option value="interval">Every N minutes</option>
      </select>
      {scheduleType === "weekly" && (
        <select
          value={weekday}
          onChange={(e) => setWeekday(parseInt(e.target.value, 10) as 0 | 1 | 2 | 3 | 4 | 5 | 6)}
          style={{ ...inputStyle, appearance: "none", cursor: "pointer", marginBottom: 6 }}
        >
          {WEEKDAYS.map((d) => (
            <option key={d.value} value={d.value}>
              {d.label}
            </option>
          ))}
        </select>
      )}
      {(scheduleType === "daily" || scheduleType === "weekly") && (
        <div style={{ display: "flex", gap: 8 }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 10, color: "var(--text-muted)", marginBottom: 4 }}>Hour (0-23)</div>
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
            <div style={{ fontSize: 10, color: "var(--text-muted)", marginBottom: 4 }}>Minute (0-59)</div>
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
          <div style={{ fontSize: 10, color: "var(--text-muted)", marginBottom: 4 }}>Interval (minutes, min 5)</div>
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
      <p style={{ fontSize: 10, color: "var(--text-ghost)", margin: "6px 0 0" }}>Times are server-local.</p>
    </>
  );
}
