import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { buildCronjobSchedule, CronjobScheduleFields } from "./CronjobScheduleFields.tsx";

test("on-demand form omits timer fields and builds a manual schedule", () => {
  const values = { scheduleType: "manual" as const, hourStr: "9", minuteStr: "30", weekday: 1 as const, intervalStr: "60" };
  expect(buildCronjobSchedule(values)).toEqual({ type: "manual" });
  const noop = () => {};
  const html = renderToStaticMarkup(
    <CronjobScheduleFields {...values} setScheduleType={noop} setHourStr={noop} setMinuteStr={noop} setWeekday={noop} setIntervalStr={noop} labelStyle={{}} inputStyle={{}} />,
  );
  expect(html).toContain('value="manual" selected=""');
  expect(html).toContain("Runs only when you choose Run now.");
  expect(html).not.toContain('type="number"');
  expect(html).not.toContain("Times are server-local");
});
