import { describe, expect, test } from "bun:test";
import { THEMES } from "./index.ts";
import { nextThemeId } from "./theme-context.tsx";

describe("nextThemeId", () => {
  test("cycles through every registered theme in order", () => {
    const seen: string[] = [];
    let current = THEMES[0].id;
    for (let i = 0; i < THEMES.length; i++) {
      seen.push(current);
      current = nextThemeId(current);
    }
    expect(seen).toEqual(THEMES.map((theme) => theme.id));
    expect(current).toBe(THEMES[0].id);
  });

  test("falls back to the default cycle start for unknown stored ids", () => {
    expect(nextThemeId("missing")).toBe(THEMES[0].id);
  });
});
