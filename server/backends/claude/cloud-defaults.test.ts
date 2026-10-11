import { expect, test } from "bun:test";
import { withCloudModelDefaults } from "./cloud-defaults.ts";
import { claudeModelCapabilities, claudeModelOverrides, claudeSessionModelOptions } from "./model-options.ts";

test("cloud defaults respect geography, explicit pins and routing choices", () => {
  const env = { CLAUDE_CODE_USE_BEDROCK: "1", AWS_REGION: "eu-west-1" };
  expect(withCloudModelDefaults(env)).toMatchObject({ ANTHROPIC_DEFAULT_SONNET_MODEL: "eu.anthropic.claude-sonnet-5-5", ANTHROPIC_DEFAULT_HAIKU_MODEL: "eu.anthropic.claude-haiku-5-5" });
  expect(Object.keys(env)).toHaveLength(2);
  expect(withCloudModelDefaults({ ...env, ANTHROPIC_DEFAULT_SONNET_MODEL: "custom-profile" }).ANTHROPIC_DEFAULT_SONNET_MODEL).toBe("custom-profile");
  expect(withCloudModelDefaults({ ...env, ANTHROPIC_BEDROCK_REGION_PREFIX: "global" }).ANTHROPIC_DEFAULT_SONNET_MODEL).toBeUndefined();
  for (const region of ["", "moon-1", "us-gov-west-1", "ca-central-1", "us-east-1 "]) {
    expect(withCloudModelDefaults({ ...env, AWS_REGION: region }).ANTHROPIC_DEFAULT_SONNET_MODEL).toBeUndefined();
  }
  const japan = withCloudModelDefaults({ ...env, AWS_REGION: "ap-northeast-1" });
  expect(japan.ANTHROPIC_DEFAULT_SONNET_MODEL).toBeUndefined();
  expect(japan.ANTHROPIC_DEFAULT_HAIKU_MODEL).toBe("jp.anthropic.claude-haiku-5-5");
  expect(withCloudModelDefaults({ ...env, ANTHROPIC_SMALL_FAST_MODEL_AWS_REGION: "us-east-1" }).ANTHROPIC_DEFAULT_HAIKU_MODEL).toBeUndefined();
});

test("Vertex defaults follow model-specific locations without overriding first-party environments", () => {
  const env = { CLAUDE_CODE_USE_VERTEX: "true", CLOUD_ML_REGION: "eu", VERTEX_REGION_CLAUDE_HAIKU_5_5: "us-central1" };
  expect(withCloudModelDefaults(env)).toMatchObject({ ANTHROPIC_DEFAULT_SONNET_MODEL: "claude-sonnet-5-5" });
  expect(withCloudModelDefaults(env).ANTHROPIC_DEFAULT_HAIKU_MODEL).toBeUndefined();
  expect(withCloudModelDefaults({ CLAUDE_CODE_USE_BEDROCK: "0", AWS_REGION: "us-east-1" }).ANTHROPIC_DEFAULT_SONNET_MODEL).toBeUndefined();
});

test("launch capabilities and labels resolve the same effective model defaults", () => {
  const env = { CLAUDE_CODE_USE_BEDROCK: "1", AWS_REGION: "us-east-1" };
  expect(claudeModelOverrides(env).sonnet).toBe("us.anthropic.claude-sonnet-5-5");
  expect(claudeModelCapabilities("sonnet", env).supportedEfforts.length).toBeGreaterThan(0);
  expect(claudeSessionModelOptions({ modelFamily: "sonnet", effort: "high", permissionMode: "auto", env })).toMatchObject({ model: "sonnet", effort: "high", permissionMode: "auto" });
  const legacy = { ...env, ANTHROPIC_DEFAULT_SONNET_MODEL: "eu.anthropic.claude-sonnet-4-5" };
  expect(claudeSessionModelOptions({ modelFamily: "sonnet", effort: "high", permissionMode: "auto", env: legacy })).toEqual({ model: "sonnet", permissionMode: "default" });
});
