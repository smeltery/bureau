import { describe, expect, test } from "bun:test";
import { nextThemeId } from "./theme-context.tsx";

describe("nextThemeId", () => {
  test("cycles through the wall theme order", () => {
    const seen: string[] = [];
    const order = ["light", "solarized-light", "nord", "solarized-dark", "dracula", "dark"];
    let current = order[0];
    for (let i = 0; i < order.length; i++) {
      seen.push(current);
      current = nextThemeId(current);
    }
    expect(seen).toEqual(order);
    expect(current).toBe(order[0]);
  });

  test("falls back to the default cycle start for unknown stored ids", () => {
    expect(nextThemeId("missing")).toBe("light");
  });
});
