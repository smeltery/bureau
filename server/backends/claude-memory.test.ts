import { describe, expect, test } from "bun:test";
import { CLAUDE_LAUNCH_SETTINGS, CLAUDE_MEMORY_OFF_SETTINGS } from "./claude.ts";

describe("Claude backend memory settings", () => {
  test("disables Claude Code auto-memory for Bureau-managed sessions", () => {
    expect(CLAUDE_MEMORY_OFF_SETTINGS).toEqual({ autoMemoryEnabled: false });
  });

  test("disables Claude Code telemetry without replacing the process env", () => {
    expect(CLAUDE_LAUNCH_SETTINGS).toEqual({
      autoMemoryEnabled: false,
      env: { DISABLE_TELEMETRY: "1", DISABLE_ERROR_REPORTING: "1" },
    });
  });
});
