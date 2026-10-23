import { expect, test } from "bun:test";
import { displayLogText, logContent, logParts } from "../../../shared/i18n/log-message.ts";
import { emptyBucket, formatInCell, formatTokenCount, formatUsd } from "../usage-format.ts";
import { reportInput, reportName, reportTokens, reportUsd } from "./report-format.ts";

test("localized usage retains established rounding and cache thresholds", () => {
  for (const value of [0, 1, 999, 1000, 1499, 1500, 999499, 999500, 1000000]) {
    expect(logContent(logParts([reportTokens(value)])).content).toBe(formatTokenCount(value));
  }
  for (const value of [0, 0.001, 1.005, 12.345, 99.995, 100, 1234.5]) {
    expect(logContent(logParts([reportUsd(value)])).content).toBe(formatUsd(value));
  }
  for (const cacheRead of [0, 79, 80, 100]) {
    const bucket = { ...emptyBucket(), totalIn: 1000, cacheRead, cacheCreation: 100 - cacheRead };
    expect(logContent(logParts([reportInput(bucket)])).content).toBe(formatInCell(bucket));
  }
  expect(displayLogText("fallback", logParts([reportUsd(1.005), " / ", reportTokens(1500000)]), "es")).toBe("$1,00 / 1,5M");
  expect(reportName("A|B\\C\nD")).toBe("A\\|B\\\\C D");
});
