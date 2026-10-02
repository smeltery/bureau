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

// Repointing a family at a newer model the bundled CLI may not know yet?
// Bump @anthropic-ai/claude-agent-sdk in the same commit so the CLI reports
// the model's real context window instead of falling back to a stale default.
export const FAMILY_TO_MODEL: Record<ModelFamily, ClaudeModel> = {
  opus: "claude-opus-5-5",
  sonnet: "claude-sonnet-5-5",
  haiku: "claude-haiku-4-5-20251001",
  fable: "claude-fable-5-1",
};

export const MODEL_FAMILIES: { family: ModelFamily; label: string }[] = [
  { family: "opus", label: "Opus" },
  { family: "sonnet", label: "Sonnet" },
  { family: "haiku", label: "Haiku" },
  { family: "fable", label: "Fable" },
];

// Static model-family IDs Bureau can validate without asking a provider. This
// is also the source for the in-chat /model picker. OpenCode's connected model
// list is runtime-only, so request paths must keep accepting a well-formed
// provider/model ID when that list is not loaded.
export function knownModelFamiliesFor(agentType: "claude" | "codex" | "opencode"): readonly string[] | null {
  if (agentType === "claude") return MODEL_FAMILIES.map((m) => m.family);
  if (agentType === "codex") return CODEX_MODELS.map((m) => m.value);
  return null;
}

// Extract "4.8" from "claude-opus-4-8" or "5.1" from
// "claude-fable-5-1" for display. Single-number slugs fall back to the
// trailing number.
export function modelVersionLabel(family: ModelFamily): string {
  const exact = FAMILY_TO_MODEL[family];
  const twoPart = exact.match(/-(\d+)-(\d+)/);
  if (twoPart) return `${twoPart[1]}.${twoPart[2]}`;
  const onePart = exact.match(/-(\d+)$/);
  return onePart ? onePart[1] : exact;
}

// Reasoning effort levels. Most are shared across Claude (--effort) and Codex
// (ReasoningEffort); `minimal` and `ultra` are Codex-only, and `max` is Claude
// top-tier families plus Codex frontier models. UI filters per backend.
export type EffortLevel = "minimal" | "low" | "medium" | "high" | "xhigh" | "max" | "ultra";

export const EFFORT_LEVELS: { level: EffortLevel; label: string }[] = [
  { level: "minimal", label: "Minimal (Codex only)" },
  { level: "low", label: "Low" },
  { level: "medium", label: "Medium" },
  { level: "high", label: "High" },
  { level: "xhigh", label: "Extra high" },
  { level: "max", label: "Max" },
  { level: "ultra", label: "Ultra (Codex only)" },
];

export const DEFAULT_EFFORT: EffortLevel = "xhigh";

export function effortDisplayLabel(level: EffortLevel | undefined): string {
  const resolved = level ?? DEFAULT_EFFORT;
  return EFFORT_LEVELS.find((e) => e.level === resolved)?.label ?? resolved;
}

export function effortLevelsFor(agentType: "claude" | "codex" | "opencode", modelFamily: string): typeof EFFORT_LEVELS {
  // Codex: full static list. The live allow-list is per-model
  // supportedReasoningEfforts from model/list; Codex rejects unsupported
  // values at thread/start (same pass-through stance as validateEffort).
  if (agentType === "codex") return EFFORT_LEVELS;
  // OpenCode: effort is accepted on the wire but not forwarded to serve yet;
  // offer the shared non-Codex-only levels so the picker stays usable.
  if (agentType === "opencode") {
    return EFFORT_LEVELS.filter((e) => e.level !== "minimal" && e.level !== "ultra" && e.level !== "max");
  }
  if (!claudeFamilySupportsEffort(modelFamily)) return [];
  return EFFORT_LEVELS.filter((e) => e.level !== "minimal" && e.level !== "ultra" && (e.level !== "max" || familyAllowsAutoPermission(modelFamily)));
}

export function claudeFamilySupportsEffort(family: string): boolean {
  return family === "opus" || family === "fable" || family === "sonnet";
}

// Codex model identifiers and UI labels. Verified against `codex debug models`
// on codex-cli 0.153.4 (2026-09-05). Default first (CODEX_MODELS[0]):
// gpt-5.6-sol; gpt-6-astra is the newer flagship (Codex 0.153 lists it first)
// and is not the default here until product owners decide otherwise.
export const CODEX_MODELS: { value: string; label: string }[] = [
  { value: "gpt-5.6-sol", label: "GPT-5.6 Sol" },
  { value: "gpt-6-astra", label: "GPT-6 Astra" },
  { value: "gpt-5.6-terra", label: "GPT-5.6 Terra" },
  { value: "gpt-5.6-luna", label: "GPT-5.6 Luna" },
  { value: "gpt-5.5", label: "GPT-5.5" },
  { value: "gpt-5.4", label: "GPT-5.4" },
  { value: "gpt-5.4-mini", label: "GPT-5.4 mini" },
];

// OpenCode model identifiers (provider/model). Live /provider discovery can
// replace this list when the local `opencode` serve is reachable.
export const OPENCODE_MODELS: { value: string; label: string }[] = [
  { value: "opencode/nemotron-3-ultra-free", label: "Nemotron 3 Ultra (free)" },
  { value: "opencode/gpt-5-nano", label: "GPT-5 Nano (OpenCode)" },
  { value: "opencode/claude-sonnet-4", label: "Claude Sonnet 4 (OpenCode)" },
  { value: "opencode/gemini-2.5-flash", label: "Gemini 2.5 Flash (OpenCode)" },
  { value: "opencode/big-pickle", label: "Big Pickle (free)" },
];

export function isClaudeFamily(s: string): s is ModelFamily {
  return s === "opus" || s === "sonnet" || s === "haiku" || s === "fable";
}

export function isOpenCodeModel(s: string): boolean {
  return s.includes("/") && !isClaudeFamily(s) && !CODEX_MODELS.some((m) => m.value === s);
}

// The classifier-backed "auto" permission mode is only offered for the
// higher-capability families that drive the safe-action classifier well.
export function familyAllowsAutoPermission(family: string | undefined): boolean {
  return family === "opus" || family === "fable" || family === "sonnet";
}

export function familyDisplayLabel(family: string): string {
  if (isClaudeFamily(family)) {
    const base = MODEL_FAMILIES.find((m) => m.family === family)?.label ?? family;
    return `${base} ${modelVersionLabel(family)}`;
  }
  return OPENCODE_MODELS.find((m) => m.value === family)?.label ?? CODEX_MODELS.find((m) => m.value === family)?.label ?? family;
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
