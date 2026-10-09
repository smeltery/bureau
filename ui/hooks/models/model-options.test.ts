import { describe, expect, test } from "bun:test";
import { mergeModelOptions, modelOptionLabel, modelAllowsAuto, modelEfforts } from "./model-options.ts";
import { resolveTemplatePermission } from "../../agent-templates.ts";

const cloudModels = [{ family: "haiku", label: "Haiku", supportedEfforts: [], supportsAutoPermission: false }];

describe("provider model choices", () => {
  test("cloud capability limits override static family defaults", () => {
    expect(modelAllowsAuto("haiku", cloudModels)).toBe(false);
    expect(modelEfforts("claude", "haiku", cloudModels)).toEqual([]);
    expect(modelAllowsAuto("haiku", [])).toBe(true);
  });
  test("offers only the advertised OpenCode effort variants", () => {
    const models = [{ family: "provider/model", label: "Model", supportedEfforts: [{ level: "low" }, { level: "max" }] }];
    expect(modelEfforts("opencode", "provider/model", models).map((option) => option.level)).toEqual(["low", "max"]);
  });
  test("retains an existing model while showing newly discovered choices", () => {
    expect(mergeModelOptions([{ family: "old", label: "Old" }], cloudModels, "old").map((model) => model.family)).toEqual(["haiku", "old"]);
  });
  test("cloud catalog labels do not claim the direct model version", () => {
    expect(modelOptionLabel("claude", { family: "haiku", label: "Haiku (cloud alias)", catalogLabel: true })).toBe("Haiku (cloud alias)");
    expect(modelOptionLabel("claude", { family: "haiku", label: "Haiku" })).toBe("Haiku (5.5)");
  });
  test("templates never broaden Auto into Bypass for an unsupported family", () => {
    expect(resolveTemplatePermission("claude", "unknown", "auto")).toBe("default");
    expect(resolveTemplatePermission("claude", "unknown", "bypassPermissions")).toBe("bypassPermissions");
  });
});
