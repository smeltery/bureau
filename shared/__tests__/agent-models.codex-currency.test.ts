import { describe, expect, test } from "bun:test";
import { CODEX_MODELS, DEFAULT_EFFORT, EFFORT_LEVELS, FAMILY_TO_MODEL, effortLevelsFor, familyAllowsAutoPermission } from "../agent-models.ts";
import { validateEffort } from "../../server/agent-validators.ts";

describe("Codex model currency", () => {
  test("offers GPT-6 Astra while keeping GPT-5.6 Sol as the default", () => {
    expect(CODEX_MODELS[0]?.value).toBe("gpt-5.6-sol");
    expect(CODEX_MODELS.some((model) => model.value === "gpt-6-astra")).toBe(true);
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

  test("does not offer effort levels for Haiku", () => {
    expect(FAMILY_TO_MODEL.sonnet).toBe("claude-sonnet-5-5");
    expect(effortLevelsFor("claude", "haiku")).toEqual([]);
    expect(effortLevelsFor("claude", "sonnet").length).toBeGreaterThan(0);
  });

  test("allows Sonnet auto permissions and max effort", () => {
    expect(familyAllowsAutoPermission("sonnet")).toBe(true);
    expect(effortLevelsFor("claude", "sonnet").some((effort) => effort.level === "max")).toBe(true);
  });
});
