import { EFFORT_LEVELS, effortLevelsFor, familyAllowsAutoPermission, modelVersionLabel, type ModelFamily, type AgentBackendType } from "../../../shared/types.ts";

export interface ModelOption {
  family: string;
  label: string;
  catalogLabel?: boolean;
  supportedEfforts?: { level: string; description?: string }[];
  supportsAutoPermission?: boolean;
}

export function modelEfforts(agentType: AgentBackendType, family: string, models: ModelOption[]) {
  const supported = models.find((model) => model.family === family)?.supportedEfforts;
  if (supported === undefined) return effortLevelsFor(agentType, family);
  return EFFORT_LEVELS.filter(({ level }) => supported.some((option) => option.level === level));
}

export function modelAllowsAuto(family: string, models: ModelOption[]): boolean {
  return models.find((model) => model.family === family)?.supportsAutoPermission ?? familyAllowsAutoPermission(family);
}

export function mergeModelOptions(fallback: ModelOption[], discovered: ModelOption[] | null, selected: string): ModelOption[] {
  if (!discovered?.length) return fallback;
  if (discovered.some((model) => model.family === selected)) return discovered;
  return [...discovered, fallback.find((model) => model.family === selected) ?? { family: selected, label: selected }];
}

export function modelOptionLabel(agentType: AgentBackendType, model: ModelOption): string {
  return agentType === "claude" && !model.catalogLabel ? `${model.label} (${modelVersionLabel(model.family as ModelFamily)})` : model.label;
}
