import { describe, expect, test } from "bun:test";
import { hasExternalAccessChanges, shouldBlockExternalAccessUnload } from "./ExternalAccessSection.tsx";

const saved = { enabled: false, urlInput: "", officeNameInput: "HQ" };

describe("hasExternalAccessChanges", () => {
  test("ignores surrounding whitespace when comparing saved text fields", () => {
    expect(hasExternalAccessChanges(false, "  ", " HQ ", saved)).toBe(false);
  });

  test("detects enabled, public url, and office name changes", () => {
    expect(hasExternalAccessChanges(true, "", "HQ", saved)).toBe(true);
    expect(hasExternalAccessChanges(false, "https://example.test", "HQ", saved)).toBe(true);
    expect(hasExternalAccessChanges(false, "", "Branch", saved)).toBe(true);
  });
});

describe("shouldBlockExternalAccessUnload", () => {
  test("blocks tab close only after loaded settings have dirty edits", () => {
    expect(shouldBlockExternalAccessUnload(false, true)).toBe(false);
    expect(shouldBlockExternalAccessUnload(true, false)).toBe(false);
    expect(shouldBlockExternalAccessUnload(true, true)).toBe(true);
  });
});
