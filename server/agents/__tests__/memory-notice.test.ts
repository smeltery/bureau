import { describe, expect, test } from "bun:test";
import { formatMemoryNotice, MEMORY_NOTICE_FILL_RATIO } from "../memory-notice.ts";

describe("formatMemoryNotice", () => {
  test("returns null when every scope is under the ratio", () => {
    expect(formatMemoryNotice([{ label: "Office-wide", contentChars: 100, cap: 2500 }])).toBeNull();
  });

  test("lists scopes at or over the ratio, fullest first", () => {
    const notice = formatMemoryNotice([
      { label: "Office-wide", contentChars: Math.floor(2500 * MEMORY_NOTICE_FILL_RATIO), cap: 2500 },
      { label: "Your agent", contentChars: 4500, cap: 5000 },
    ]);
    expect(notice).toContain("Your agent at 90% of its cap");
    expect(notice).toContain("Office-wide at 80% of its cap");
  });

  test("calls out scopes at or over 100%", () => {
    const notice = formatMemoryNotice([{ label: "Office-wide", contentChars: 2600, cap: 2500 }]);
    expect(notice).toContain("at or over its cap");
  });
});
