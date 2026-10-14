import { expect, test } from "bun:test";
import { compactionThreshold } from "./context-limits.ts";

test("compaction thresholds account for input limits and configured reserves", () => {
  expect(compactionThreshold({ context: 200000 }, undefined)).toBe(168000);
  expect(compactionThreshold({ context: 200000, input: 190000, output: 8000 }, undefined)).toBe(182000);
  expect(compactionThreshold({ context: 200000, input: 190000 }, { reserved: 5000 })).toBe(185000);
  expect(compactionThreshold({ context: 200000 }, undefined, "16000")).toBe(184000);
  expect(compactionThreshold({ context: 200000 }, { auto: false })).toBeUndefined();
});
