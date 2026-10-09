import { describe, expect, test } from "bun:test";
import { CODEX_MODELS, DEFAULT_EFFORT, EFFORT_LEVELS, FAMILY_TO_MODEL, effortLevelsFor, familyAllowsAutoPermission } from "../agent-models.ts";
import { validateEffort } from "../../server/agent-validators.ts";

describe("Codex model currency", () => {
  test("offers the GPT-6 family while keeping GPT-5.6 Sol as the default", () => {
    expect(CODEX_MODELS[0]?.value).toBe("gpt-5.6-sol");
    for (const slug of ["gpt-6.1-sol", "gpt-6-astra", "gpt-6-sol", "gpt-6-luna"]) {
      expect(CODEX_MODELS.some((model) => model.value === slug)).toBe(true);
    }
  });

  test("drops models Codex 0.160 no longer lists", () => {
    expect(CODEX_MODELS.some((model) => model.value.startsWith("gpt-5.4"))).toBe(false);
  });

  test("lists ultra as a Codex effort and hides it from Claude", () => {
    expect(EFFORT_LEVELS.some((effort) => effort.level === "ultra")).toBe(true);
    expect(effortLevelsFor("codex", "gpt-6-astra").some((effort) => effort.level === "ultra")).toBe(true);
    expect(effortLevelsFor("claude", "opus").some((effort) => effort.level === "ultra")).toBe(false);
    expect(effortLevelsFor("claude", "opus").some((effort) => effort.level === "minimal")).toBe(false);
  });

  test("rejects Codex-only ultra effort on Claude agents", () => {
    expect(validateEffort("claude", "opus", "ultra")).toBe(DEFAULT_EFFORT);
    expect(validateEffort("codex", "gpt-6-astra", "ultra")).toBe("ultra");
  });

  test("offers effort levels for Haiku 5.5", () => {
    expect(FAMILY_TO_MODEL.sonnet).toBe("claude-sonnet-5-5");
    expect(FAMILY_TO_MODEL.haiku).toBe("claude-haiku-5-5");
    expect(effortLevelsFor("claude", "haiku").map(({ level }) => level)).toEqual(["low", "medium", "high", "xhigh", "max"]);
    expect(effortLevelsFor("claude", "sonnet").length).toBeGreaterThan(0);
  });

  test("allows Sonnet auto permissions and max effort", () => {
    expect(familyAllowsAutoPermission("sonnet")).toBe(true);
    expect(effortLevelsFor("claude", "sonnet").some((effort) => effort.level === "max")).toBe(true);
  });
});
