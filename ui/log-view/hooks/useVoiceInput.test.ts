import { describe, expect, test } from "bun:test";
import { joinSpoken } from "./useVoiceInput.ts";

describe("joinSpoken", () => {
  test("inserts one separating space when dictation segments touch", () => {
    expect(joinSpoken("Fix", "bug")).toBe("Fix bug");
  });

  test("preserves existing whitespace at segment boundaries", () => {
    expect(joinSpoken("Fix ", "bug")).toBe("Fix bug");
    expect(joinSpoken("Fix", " bug")).toBe("Fix bug");
  });

  test("returns the present side when either side is empty", () => {
    expect(joinSpoken("", "hello")).toBe("hello");
    expect(joinSpoken("hello", "")).toBe("hello");
  });
});
