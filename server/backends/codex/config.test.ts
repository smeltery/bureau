import { describe, expect, test } from "bun:test";

import { DEFAULT_SANDBOX_MODE } from "./config.ts";

describe("Codex backend config", () => {
  test("defaults to the same full-access posture as agent spawns", () => {
    expect(DEFAULT_SANDBOX_MODE).toBe("danger-full-access");
  });
});
