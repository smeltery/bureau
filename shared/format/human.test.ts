import { describe, expect, test } from "bun:test";
import { formatSize } from "./human.ts";

describe("formatSize", () => {
  test("bytes stay whole", () => {
    expect(formatSize(0)).toBe("0 B");
    expect(formatSize(1)).toBe("1 B");
    expect(formatSize(512)).toBe("512 B");
    expect(formatSize(1023)).toBe("1023 B");
  });

  test("scales past MB, which is the bug this replaced", () => {
    // Two of the four copies stopped at MB, so a 50 GB office read as
    // "51200.0 MB" in the Storage modal while the report said "50 GB".
    expect(formatSize(1024 ** 3 * 50)).toBe("50 GB");
    expect(formatSize(1024 ** 4 * 2)).toBe("2 TB");
    // TB is the ceiling: beyond it the number grows rather than the unit, which
    // is honest for a figure nothing in an office should reach.
    expect(formatSize(1024 ** 5)).toBe("1024 TB");
  });

  test("a decimal only where it carries information", () => {
    expect(formatSize(1024)).toBe("1 KB"); // whole
    expect(formatSize(1536)).toBe("1.5 KB"); // a half is worth showing
    expect(formatSize(1024 * 10)).toBe("10 KB"); // double digits: a tenth is noise
    expect(formatSize(1024 * 10 + 200)).toBe("10 KB");
    expect(formatSize(1024 * 1024 * 1.5)).toBe("1.5 MB");
  });

  test("the boundary rolls over to the next unit rather than reading 1024", () => {
    expect(formatSize(1024 * 1024 - 1)).toBe("1024 KB");
    expect(formatSize(1024 * 1024)).toBe("1 MB");
  });

  test("an unmeasurable count says so instead of printing a confident zero", () => {
    expect(formatSize(Number.NaN)).toBe("unknown size");
    expect(formatSize(Number.POSITIVE_INFINITY)).toBe("unknown size");
    expect(formatSize(-1)).toBe("unknown size");
  });
});
