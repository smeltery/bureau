import { expect, test } from "bun:test";
import { agentModelLabel, familyDisplayLabel } from "../agent-models.ts";

test("OpenCode stays identifiable regardless of provider model naming", () => {
  for (const model of ["gpt-provider/model", "claude-provider/model", "anthropic/claude-sonnet-4-6", "custom/model"]) {
    expect(agentModelLabel("opencode", model)).toBe(`${familyDisplayLabel(model)} · OpenCode`);
    expect(agentModelLabel("claude", model)).toBe(familyDisplayLabel(model));
    expect(agentModelLabel("codex", model)).toBe(familyDisplayLabel(model));
  }
  expect(agentModelLabel("claude", "sonnet", { sonnet: "claude-sonnet-custom" })).toBe(familyDisplayLabel("sonnet", { sonnet: "claude-sonnet-custom" }));
});
