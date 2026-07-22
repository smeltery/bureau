import { describe, expect, test } from "bun:test";
import { describeFocusTarget, focusDebugEnabled } from "./focus-debug.ts";

describe("focus debug", () => {
  test("is enabled only by the explicit localStorage flag", () => {
    expect(focusDebugEnabled({ getItem: () => "1" })).toBe(true);
    expect(focusDebugEnabled({ getItem: () => "0" })).toBe(false);
    expect(focusDebugEnabled({ getItem: () => null })).toBe(false);
    expect(focusDebugEnabled(undefined)).toBe(false);
  });

  test("treats storage errors as disabled", () => {
    expect(
      focusDebugEnabled({
        getItem: () => {
          throw new Error("SecurityError");
        },
      }),
    ).toBe(false);
  });

  test("describes non-element targets without leaking object stringification", () => {
    expect(describeFocusTarget(null)).toBe("null");
    expect(describeFocusTarget("text")).toBe("<String>");
    expect(describeFocusTarget({ constructor: { name: "CustomTarget" } })).toBe("<CustomTarget>");
  });
});
