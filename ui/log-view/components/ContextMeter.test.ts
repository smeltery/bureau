import { describe, expect, test } from "bun:test";
import { contextMeterColor, contextMeterView } from "./ContextMeter.tsx";

describe("ContextMeter", () => {
  test("uses raw context fullness for color bands", () => {
    expect(contextMeterColor(0)).toBe("var(--text-muted)");
    expect(contextMeterColor(49.9)).toBe("var(--text-muted)");
    expect(contextMeterColor(50)).toBe("var(--orange)");
    expect(contextMeterColor(74.9)).toBe("var(--orange)");
    expect(contextMeterColor(75)).toBe("var(--red)");
    expect(contextMeterColor(100)).toBe("var(--red)");
  });

  test("renders an explicit unknown state when no usage has been measured", () => {
    expect(contextMeterView(null)).toEqual({
      color: "var(--text-ghost)",
      label: "?",
      remaining: 0,
      title: "Context usage not measured yet. It updates when the agent finishes a turn.",
    });
  });

  test("reports remaining context while coloring by fullness", () => {
    const view = contextMeterView({
      model: "claude-sonnet",
      totalTokens: 76,
      maxTokens: 100,
      percentage: 76,
      sampledAtMs: 1,
    });

    expect(view.color).toBe("var(--red)");
    expect(view.label).toBe("24%");
    expect(view.remaining).toBe(24);
    expect(view.title).toContain("76% full, 24% left");
  });
});
