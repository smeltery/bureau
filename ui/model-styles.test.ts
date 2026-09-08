import { describe, expect, test } from "bun:test";
import { FALLBACK_PALETTE, MODEL_STYLES, NEUTRAL_STYLE, styleForModel } from "./model-styles.ts";

describe("styleForModel", () => {
  test("keeps existing Claude tints stable", () => {
    expect(styleForModel("opus")).toBe(MODEL_STYLES.opus);
    expect(styleForModel("opus").border).toBe("rgba(100,160,255,0.85)");
    expect(styleForModel("sonnet").bg).toBe("rgba(218,165,32,0.32)");
    expect(styleForModel("haiku").deskProp).toBe("crayons");
  });

  test("styles known Codex model families", () => {
    expect(styleForModel("gpt-5.6-sol").deskProp).toBe("book");
    expect(styleForModel("gpt-6-astra").deskProp).toBe("book");
    expect(styleForModel("gpt-6-astra").border).toBe("rgba(60,230,190,0.95)");
    expect(styleForModel("gpt-5.6-terra").deskProp).toBeUndefined();
    expect(styleForModel("gpt-5.6-luna").deskProp).toBe("crayons");
    expect(styleForModel("gpt-5.4-mini").border).toBe("rgba(120,220,160,0.62)");
  });

  test("missing model identity stays neutral", () => {
    expect(styleForModel(undefined)).toBe(NEUTRAL_STYLE);
    expect(styleForModel("")).toBe(NEUTRAL_STYLE);
  });

  test("unknown model identities receive deterministic fallback styles", () => {
    for (const model of ["gpt-6", "claude-future", "constructor", "__proto__", "custom-model"]) {
      const style = styleForModel(model);
      expect(styleForModel(model)).toBe(style);
      expect(FALLBACK_PALETTE.includes(style)).toBe(true);
      expect(style.deskProp).toBeUndefined();
    }
  });
});
