import { expect, test } from "bun:test";
import { familyDisplayLabel } from "../../../shared/types.ts";
import { sessionModelMetadata } from "./model-metadata.ts";

test("launch metadata preserves preferences and reflects cloud permission fallback", () => {
  const info = { agentType: "claude" as const, modelFamily: "haiku", permissionMode: "auto" as const };
  const metadata = sessionModelMetadata(info, { CLAUDE_CODE_USE_VERTEX: "1" });
  expect(metadata.effectivePermissionMode).toBe("default");
  expect(familyDisplayLabel(info.modelFamily, metadata.claudeModelOverrides)).toBe("Haiku 4.5");
  expect(info.permissionMode).toBe("auto");
  expect(sessionModelMetadata(info, {}).effectivePermissionMode).toBe("auto");
  expect(sessionModelMetadata({ ...info, agentType: "codex", permissionMode: "never" }, {}).claudeModelOverrides).toBeUndefined();
});

test("pins are snapshots and custom identifiers remain intact", () => {
  const env = { CLAUDE_CODE_USE_VERTEX: "1", ANTHROPIC_DEFAULT_SONNET_MODEL: "claude-sonnet-5-5" };
  const info = { agentType: "claude" as const, modelFamily: "sonnet", permissionMode: "auto" as const };
  const metadata = sessionModelMetadata(info, env);
  env.ANTHROPIC_DEFAULT_SONNET_MODEL = "custom-7-8-route";
  expect(familyDisplayLabel(info.modelFamily, metadata.claudeModelOverrides)).toBe("Sonnet 5.5");
  expect(metadata.effectivePermissionMode).toBe("auto");
  const next = sessionModelMetadata(info, env);
  expect(familyDisplayLabel(info.modelFamily, next.claudeModelOverrides)).toBe("Sonnet custom-7-8-route");
  expect(next.effectivePermissionMode).toBe("default");
  expect(familyDisplayLabel("sonnet", { sonnet: "claude-opus-5-5" })).toBe("Sonnet claude-opus-5-5");
});
