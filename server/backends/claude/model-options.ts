import type { Options } from "@anthropic-ai/claude-agent-sdk";
import { FAMILY_TO_MODEL, MODEL_FAMILIES, modelVersionLabel, effortLevelsFor, familyAllowsAutoPermission, type ModelFamily } from "../../../shared/types.ts";
import type { BackendModel, CreateSessionOptions } from "../types.ts";
import { isClaudeCloudSelected } from "../claude-install-check.ts";

type Environment = Record<string, string | undefined>;

export function claudeModelForEnvironment(family: string, env: Environment = process.env): string {
  return isClaudeCloudSelected(env) ? family : (FAMILY_TO_MODEL[family as ModelFamily] ?? family);
}

/** Cloud aliases still select older Sonnet/Haiku unless explicitly pinned. */
export function claudeModelCapabilities(family: string, env: Environment = process.env) {
  const cloudLimited =
    isClaudeCloudSelected(env) &&
    ((family === "sonnet" && !/claude-sonnet-5(?:\D|$)/i.test(env.ANTHROPIC_DEFAULT_SONNET_MODEL ?? "")) ||
      (family === "haiku" && !/claude-haiku-5-5(?:\D|$)/i.test(env.ANTHROPIC_DEFAULT_HAIKU_MODEL ?? "")));
  return {
    supportedEfforts: cloudLimited ? [] : effortLevelsFor("claude", family).map(({ level }) => ({ level })),
    supportsAutoPermission: !cloudLimited && familyAllowsAutoPermission(family),
  };
}

export function claudeSessionModelOptions(opts: Pick<CreateSessionOptions, "modelFamily" | "effort" | "permissionMode" | "env">): Pick<Options, "model" | "effort" | "permissionMode"> {
  const capabilities = claudeModelCapabilities(opts.modelFamily, opts.env);
  const effort = capabilities.supportedEfforts.some(({ level }) => level === opts.effort) ? (opts.effort as Options["effort"]) : undefined;
  return {
    model: claudeModelForEnvironment(opts.modelFamily, opts.env),
    permissionMode: opts.permissionMode === "auto" && !capabilities.supportsAutoPermission ? "default" : (opts.permissionMode as Options["permissionMode"]),
    ...(effort ? { effort } : {}),
  };
}

export function claudeModelsForEnvironment(env?: Environment): BackendModel[] {
  return MODEL_FAMILIES.map(({ family, label }) => ({
    id: family,
    label: `${label} (${isClaudeCloudSelected(env ?? process.env) ? "cloud alias" : modelVersionLabel(family)})`,
    isDefault: family === "opus",
    ...claudeModelCapabilities(family, env),
  }));
}
