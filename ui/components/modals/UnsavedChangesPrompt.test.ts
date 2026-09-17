import { describe, expect, test } from "bun:test";
import { settingsLeaveKind } from "./UnsavedChangesPrompt.tsx";

describe("settingsLeaveKind", () => {
  test("prefers an in-flight storage cleanup over ordinary form dirty", () => {
    expect(settingsLeaveKind(false, false)).toBe("none");
    expect(settingsLeaveKind(true, false)).toBe("discard");
    expect(settingsLeaveKind(false, true)).toBe("storage-leave");
    expect(settingsLeaveKind(true, true)).toBe("storage-leave");
  });
});
