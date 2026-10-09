import { describe, expect, test } from "bun:test";
import { claudeModelsForEnvironment, claudeSessionModelOptions } from "./model-options.ts";

const selected = { modelFamily: "haiku", effort: "max" as const, permissionMode: "auto" as const };

describe("Claude model capabilities", () => {
  test("Haiku uses the current model, effort, and Auto on direct access", () => {
    expect(claudeSessionModelOptions({ ...selected, env: {} })).toEqual({ model: "claude-haiku-5-5", effort: "max", permissionMode: "auto" });
    expect(claudeModelsForEnvironment({}).find((model) => model.id === "haiku")).toMatchObject({ supportsAutoPermission: true, supportedEfforts: expect.arrayContaining([{ level: "max" }]) });
  });

  for (const selector of ["CLAUDE_CODE_USE_BEDROCK", "CLAUDE_CODE_USE_VERTEX"]) {
    for (const modelFamily of ["sonnet", "haiku"]) {
      test(`${selector} keeps the ${modelFamily} alias but disables unsupported effort and Auto`, () => {
        const env = { [selector]: "true" };
        expect(claudeSessionModelOptions({ ...selected, modelFamily, env })).toEqual({ model: modelFamily, permissionMode: "default" });
        expect(claudeModelsForEnvironment(env).find((model) => model.id === modelFamily)).toMatchObject({ supportsAutoPermission: false, supportedEfforts: [] });
        expect(claudeSessionModelOptions({ ...selected, modelFamily, permissionMode: "bypassPermissions", env }).permissionMode).toBe("bypassPermissions");
      });
    }
  }

  test("explicit cloud pins restore capabilities only for supported model versions", () => {
    for (const pin of ["us.anthropic.claude-haiku-5-5", "CLAUDE-HAIKU-5-5@20261001"]) {
      expect(claudeSessionModelOptions({ ...selected, env: { CLAUDE_CODE_USE_VERTEX: "1", ANTHROPIC_DEFAULT_HAIKU_MODEL: pin } })).toEqual({ model: "haiku", effort: "max", permissionMode: "auto" });
    }
    for (const pin of ["claude-haiku-4-5", "claude-haiku-5-50", "custom-model"]) {
      expect(claudeSessionModelOptions({ ...selected, env: { CLAUDE_CODE_USE_BEDROCK: "1", ANTHROPIC_DEFAULT_HAIKU_MODEL: pin } })).toEqual({ model: "haiku", permissionMode: "default" });
    }
    expect(claudeSessionModelOptions({ ...selected, modelFamily: "sonnet", env: { CLAUDE_CODE_USE_BEDROCK: "1", ANTHROPIC_DEFAULT_SONNET_MODEL: "us.anthropic.claude-sonnet-5-5" } })).toMatchObject({
      effort: "max",
      permissionMode: "auto",
    });
  });

  test("does not pass Codex-only effort values to Claude", () => {
    for (const effort of ["minimal", "ultra"] as const) expect(claudeSessionModelOptions({ ...selected, effort, env: {} })).not.toHaveProperty("effort");
  });
});
