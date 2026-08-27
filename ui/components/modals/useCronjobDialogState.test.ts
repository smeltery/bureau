import { describe, expect, test } from "bun:test";

import { defaultCronjobCodexSandboxForTest } from "./useCronjobDialogState.ts";

describe("useCronjobDialogState", () => {
  test("defaults new Codex cron jobs to full access", () => {
    expect(defaultCronjobCodexSandboxForTest()).toBe("danger-full-access");
  });
});
