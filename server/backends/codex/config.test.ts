import { describe, expect, test } from "bun:test";

import { CODEX_THREAD_CONFIG_OVERRIDES, DEFAULT_SANDBOX_MODE } from "./config.ts";

describe("Codex backend config", () => {
  test("defaults to the same full-access posture as agent spawns", () => {
    expect(DEFAULT_SANDBOX_MODE).toBe("danger-full-access");
  });

  test("disables Codex native memories for Bureau-managed threads", () => {
    expect(CODEX_THREAD_CONFIG_OVERRIDES).toEqual({
      "memories.use_memories": false,
      "memories.generate_memories": false,
    });
  });
});
