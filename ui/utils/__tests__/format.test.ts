import { describe, expect, test } from "bun:test";
import { formatFileSize } from "../format.ts";

describe("formatFileSize", () => {
  test("returns the empty string for zero bytes (intentional UX choice)", () => {
    expect(formatFileSize(0)).toBe("");
  });

  test("uses B for sub-kilobyte sizes", () => {
    expect(formatFileSize(1)).toBe("1 B");
    expect(formatFileSize(512)).toBe("512 B");
    expect(formatFileSize(1023)).toBe("1023 B");
  });

  test("uses KB for sub-megabyte sizes (1 decimal)", () => {
    expect(formatFileSize(1024)).toBe("1.0 KB");
    expect(formatFileSize(1536)).toBe("1.5 KB");
    expect(formatFileSize(1024 * 1024 - 1)).toBe("1024.0 KB");
  });

  test("uses MB at and above 1 MiB (1 decimal)", () => {
    expect(formatFileSize(1024 * 1024)).toBe("1.0 MB");
    expect(formatFileSize(1024 * 1024 * 2)).toBe("2.0 MB");
    expect(formatFileSize(1024 * 1024 * 5 + 512 * 1024)).toBe("5.5 MB");
  });

  test("monotonically increases across the boundary", () => {
    const a = formatFileSize(1023);
    const b = formatFileSize(1024);
    const c = formatFileSize(1024 * 1024);
    expect(a).toBe("1023 B");
    expect(b).toBe("1.0 KB");
    expect(c).toBe("1.0 MB");
  });
});
