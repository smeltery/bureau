import { describe, expect, test } from "bun:test";
import { validateCronjobPermissionMode } from "../agent-validators.ts";

describe("validateCronjobPermissionMode", () => {
  test("keeps the unattended cron mode", () => {
    expect(validateCronjobPermissionMode("claude", "bypassPermissions")).toBe("bypassPermissions");
  });

  test("coerces legacy auto cron records to bypass", () => {
    expect(validateCronjobPermissionMode("claude", "auto")).toBe("bypassPermissions");
  });

  test("coerces unknown cron modes to bypass", () => {
    expect(validateCronjobPermissionMode("claude", "default")).toBe("bypassPermissions");
    expect(validateCronjobPermissionMode("claude", undefined)).toBe("bypassPermissions");
  });

  test("uses never for unattended codex cron records", () => {
    expect(validateCronjobPermissionMode("codex", "on-request")).toBe("never");
    expect(validateCronjobPermissionMode("codex", undefined)).toBe("never");
  });

  test("uses bypass for unattended opencode cron records", () => {
    expect(validateCronjobPermissionMode("opencode", "default")).toBe("bypassPermissions");
    expect(validateCronjobPermissionMode("opencode", undefined)).toBe("bypassPermissions");
  });
});
