import { describe, expect, test } from "bun:test";
import { CLAUDE_MEMORY_OFF_SETTINGS } from "./claude.ts";

describe("Claude backend memory settings", () => {
  test("disables Claude Code auto-memory for Bureau-managed sessions", () => {
    expect(CLAUDE_MEMORY_OFF_SETTINGS).toEqual({ autoMemoryEnabled: false });
  });
});
