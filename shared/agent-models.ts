export type ClaudePermissionMode = "default" | "acceptEdits" | "bypassPermissions" | "auto";
export type CodexApprovalPolicy = "untrusted" | "on-request" | "on-failure" | "never";
export type CodexSandboxMode = "read-only" | "workspace-write" | "danger-full-access";
export type AgentPermissionMode = ClaudePermissionMode | CodexApprovalPolicy;

export interface AgentCapabilities {
  fork: boolean;
  hooks: boolean;
  skills: boolean;
  oneShot: boolean;
  canUseTool: boolean;
  topicGen: boolean;
  edit: boolean;
  mcp: boolean;
}

export const DEFAULT_AGENT_CAPABILITIES: AgentCapabilities = {
  fork: true,
  hooks: true,
  skills: true,
  oneShot: true,
  canUseTool: true,
  topicGen: true,
  edit: true,
  mcp: true,
};

// Model families — what users pick ("I want Opus"). Exact versions are an
// implementation detail that the system bumps centrally in FAMILY_TO_MODEL.
export type ModelFamily = "opus" | "sonnet" | "haiku" | "fable";

export type ClaudeModel = string;

export const FAMILY_TO_MODEL: Record<ModelFamily, ClaudeModel> = {
  opus: "claude-opus-4-8",
  sonnet: "claude-sonnet-4-6",
  haiku: "claude-haiku-4-5-20251001",
  fable: "claude-fable-5",
};

export const MODEL_FAMILIES: { family: ModelFamily; label: string }[] = [
  { family: "opus", label: "Opus" },
  { family: "sonnet", label: "Sonnet" },
  { family: "haiku", label: "Haiku" },
  { family: "fable", label: "Fable" },
];

// Extract "4.8" from "claude-opus-4-8" for display. Single-number slugs like
// "claude-fable-5" have no minor segment, so fall back to the trailing number.
export function modelVersionLabel(family: ModelFamily): string {
  const exact = FAMILY_TO_MODEL[family];
  const twoPart = exact.match(/-(\d+)-(\d+)/);
  if (twoPart) return `${twoPart[1]}.${twoPart[2]}`;
  const onePart = exact.match(/-(\d+)$/);
  return onePart ? onePart[1] : exact;
}

export type EffortLevel = "minimal" | "low" | "medium" | "high" | "xhigh" | "max";

export const EFFORT_LEVELS: { level: EffortLevel; label: string }[] = [
  { level: "minimal", label: "Minimal (Codex only)" },
  { level: "low", label: "Low" },
  { level: "medium", label: "Medium" },
  { level: "high", label: "High" },
  { level: "xhigh", label: "Extra high" },
  { level: "max", label: "Max (Opus/Fable only)" },
];

export const DEFAULT_EFFORT: EffortLevel = "xhigh";

export function effortDisplayLabel(level: EffortLevel | undefined): string {
  const resolved = level ?? DEFAULT_EFFORT;
  return EFFORT_LEVELS.find((e) => e.level === resolved)?.label ?? resolved;
}

export const CODEX_MODELS: { value: string; label: string }[] = [
  { value: "gpt-5.6-sol", label: "GPT-5.6 Sol" },
  { value: "gpt-5.6-terra", label: "GPT-5.6 Terra" },
  { value: "gpt-5.6-luna", label: "GPT-5.6 Luna" },
  { value: "gpt-5.5", label: "GPT-5.5" },
  { value: "gpt-5.4", label: "GPT-5.4" },
  { value: "gpt-5.4-mini", label: "GPT-5.4 mini" },
];

export function isClaudeFamily(s: string): s is ModelFamily {
  return s === "opus" || s === "sonnet" || s === "haiku" || s === "fable";
}

// The classifier-backed "auto" permission mode is only offered for the
// higher-capability families that drive the safe-action classifier well.
export function familyAllowsAutoPermission(family: string | undefined): boolean {
  return family === "opus" || family === "fable";
}

export function familyDisplayLabel(family: string): string {
  if (!isClaudeFamily(family)) {
    return CODEX_MODELS.find((m) => m.value === family)?.label ?? family;
  }
  const base = MODEL_FAMILIES.find((m) => m.family === family)?.label ?? family;
  return `${base} ${modelVersionLabel(family)}`;
}

// Migrate a legacy exact model ID (e.g. "claude-opus-4-6") to a family.
export function familyFromLegacyModel(model: string | undefined): ModelFamily {
  if (!model) return "opus";
  if (model.includes("opus")) return "opus";
  if (model.includes("sonnet")) return "sonnet";
  if (model.includes("haiku")) return "haiku";
  if (model.includes("fable")) return "fable";
  return "opus";
}
