import { describe, expect, test } from "bun:test";

import { exitCodeFor, formatCheck, type DoctorCheck } from "./doctor.ts";

describe("doctor formatting", () => {
  test("formats pass, warn, and fail statuses", () => {
    expect(formatCheck({ name: "Bun runtime", status: "pass", message: "1.2.3" })).toBe("OK   Bun runtime: 1.2.3");
    expect(formatCheck({ name: "Browser preview", status: "warn", message: "missing", detail: "optional" })).toBe("WARN Browser preview: missing\n     optional");
    expect(formatCheck({ name: "Terminal sidecar", status: "fail", message: "broken" })).toBe("FAIL Terminal sidecar: broken");
  });

  test("exits nonzero only for failed required checks", () => {
    const warnOnly: DoctorCheck[] = [{ name: "Browser preview", status: "warn", message: "optional" }];
    const failed: DoctorCheck[] = [...warnOnly, { name: "State directory", status: "fail", message: "not writable" }];
    expect(exitCodeFor(warnOnly)).toBe(0);
    expect(exitCodeFor(failed)).toBe(1);
  });
});
