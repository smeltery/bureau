// Server-side validation for backend-specific spawn/edit options.
//
// The wire types are permissive (e.g. AgentInfo.permissionMode unions both
// backends' enums), so we narrow per agentType here. UI shouldn't send
// mismatched values, but a stale tab or hand-crafted client could.
//
// Used by both agent-manager.ts (agent spawn/edit) and the cronjob HTTP
// handlers (cron add/update). Cron-specific narrowing lives in
// validateCronjobPermissionMode below — its allowlist is a subset of the
// agent allowlist because cron runs unattended.

import {
  CODEX_MODELS,
  DEFAULT_EFFORT,
  EFFORT_LEVELS,
  FAMILY_TO_MODEL,
  MODEL_FAMILIES,
  isClaudeFamily,
  OPENCODE_MODELS,
  type AgentBackendType,
  type AgentPermissionMode,
  type CodexSandboxMode,
  type CronjobPermissionMode,
  type EffortLevel,
} from "../shared/types.ts";

const OPENCODE_TRACER_MODEL = "opencode/fake";

export function validatePermissionMode(agentType: AgentBackendType, raw: AgentPermissionMode | undefined): AgentPermissionMode {
  if (agentType === "codex") {
    // "on-failure" is deprecated in codex 0.130 (warns on use); migrate
    // to "on-request" at the boundary so we never persist the legacy value.
    if (raw === "on-failure") return "on-request";
    if (raw === "untrusted" || raw === "on-request" || raw === "never") return raw;
    return "on-request";
  }
  if (agentType === "opencode") {
    if (raw === "default" || raw === "bypassPermissions") return raw;
    return "default";
  }
  if (raw === "default" || raw === "acceptEdits" || raw === "bypassPermissions" || raw === "auto") return raw;
  return "auto";
}

export function validateModelFamily(agentType: AgentBackendType, raw: string | undefined): string {
  if (agentType === "codex") {
    // Pass-through: the picker is fed by Codex's model/list RPC which
    // returns auth-appropriate slugs that aren't necessarily in our
    // hardcoded CODEX_MODELS. We can't statically know the valid set, so
    // trust any non-empty string and let codex itself reject at thread/
    // start with a "model not supported" turn error (whose system_text
    // hint already points the user back at settings).
    if (raw && typeof raw === "string" && raw.length > 0) return raw;
    return CODEX_MODELS[0].value;
  }
  if (agentType === "opencode") {
    // Pass-through provider/model ids from live /provider discovery.
    if (raw && typeof raw === "string" && raw.includes("/")) return raw;
    return OPENCODE_MODELS[0].value;
  }
  if (raw && isClaudeFamily(raw)) return raw;
  return "opus";
}

export function modelFamilyMismatchError(agentType: AgentBackendType, raw: string | undefined): string | null {
  if (agentType === "opencode") {
    if (raw === undefined || raw === "") return "OpenCode requires a connected provider/model selection.";
    if (raw === OPENCODE_TRACER_MODEL) return "The OpenCode tracer model is not available for production agents. Select a connected model.";
    if (!raw.includes("/")) return `"${raw}" is not an OpenCode provider/model ID (expected provider/model).`;
    return null;
  }
  if (raw === undefined || raw === "") return null;
  if (agentType === "codex") {
    if (isClaudeFamily(raw)) return `"${raw}" is not a Codex model.`;
    const lower = raw.toLowerCase();
    const claudeShaped = lower.startsWith("claude-") || MODEL_FAMILIES.some(({ family }) => lower === family || lower.startsWith(`${family}-`));
    if (claudeShaped) return `"${raw}" is not a Codex model.`;
    return null;
  }
  if (isClaudeFamily(raw)) return null;
  const families = MODEL_FAMILIES.map((m) => m.family).join(", ");
  return `"${raw}" is not a Claude model family (valid: ${families}). For a Codex model, set agentType to "codex".`;
}

export class InvalidModelFamilyError extends Error {
  readonly code = "invalid_model_family" as const;
  constructor(message: string) {
    super(message);
    this.name = "InvalidModelFamilyError";
  }
}

/** Refuse a family that cannot belong to agentType. Used by cron create/update before persist. */
export function assertModelFamilyForAgentType(agentType: AgentBackendType, raw: string | undefined): void {
  const err = modelFamilyMismatchError(agentType, raw);
  if (err) throw new InvalidModelFamilyError(err);
}

export function resolveInteractiveModelSelection(agentType: AgentBackendType, modelFamily: string | undefined, model: string | undefined): { modelFamily: string | undefined; error: string | null } {
  let resolvedFamily = modelFamily;
  if (resolvedFamily === undefined && model === undefined && agentType !== "opencode") {
    resolvedFamily = validateModelFamily(agentType, undefined);
  }
  if (resolvedFamily === undefined && model !== undefined) {
    if (agentType === "claude") {
      resolvedFamily = MODEL_FAMILIES.find(({ family }) => FAMILY_TO_MODEL[family] === model)?.family;
      if (resolvedFamily === undefined) {
        return {
          modelFamily: undefined,
          error: `"${model}" is not a mapped Claude model. Pass modelFamily instead (valid: ${MODEL_FAMILIES.map(({ family }) => family).join(", ")}).`,
        };
      }
    } else {
      resolvedFamily = model;
    }
  }
  const familyError = modelFamilyMismatchError(agentType, resolvedFamily);
  if (familyError) return { modelFamily: resolvedFamily, error: familyError };
  if (model === undefined || resolvedFamily === undefined || resolvedFamily === "") return { modelFamily: resolvedFamily, error: null };
  const expected = agentType === "claude" && isClaudeFamily(resolvedFamily) ? FAMILY_TO_MODEL[resolvedFamily] : resolvedFamily;
  return {
    modelFamily: resolvedFamily,
    error: model === expected ? null : `modelFamily "${resolvedFamily}" resolves to model "${expected}", not "${model}".`,
  };
}

export function validateCodexSandbox(raw: CodexSandboxMode | undefined): CodexSandboxMode | undefined {
  if (raw === "read-only" || raw === "workspace-write" || raw === "danger-full-access") return raw;
  return undefined;
}

export function validateEffort(agentType: AgentBackendType, modelFamily: string, raw: EffortLevel | undefined): EffortLevel {
  if (agentType === "codex") {
    // Pass-through for Codex: the per-model supportedReasoningEfforts from
    // model/list is the real allow-list, and it can include values outside
    // our static EFFORT_LEVELS (e.g. "none"). Trust any non-empty string
    // and let codex reject at thread/start.
    if (raw && typeof raw === "string" && raw.length > 0) return raw;
    return DEFAULT_EFFORT;
  }
  if (!raw || !EFFORT_LEVELS.some((e) => e.level === raw)) return DEFAULT_EFFORT;
  // Claude / OpenCode: "minimal"/"ultra" are Codex-only; "max" is opus/fable-only.
  if (raw === "minimal" || raw === "ultra") return DEFAULT_EFFORT;
  if (agentType === "opencode" && raw === "max") return DEFAULT_EFFORT;
  if (raw === "max" && modelFamily !== "opus" && modelFamily !== "fable") return DEFAULT_EFFORT;
  return raw;
}

// Cron-specific permission narrowing. The full agent permission set includes
// modes that block on human approval (Claude "default"/"acceptEdits"/"auto",
// Codex "untrusted"/"on-request"); those would hang forever in an unattended
// run because cron has no /resolve responder. Falls back to each backend's
// unattended mode.
//
// Claude "auto" is explicitly excluded — ClaudeSession always installs
// canUseTool, and cron's normalized consumer can't resolve approval_request
// events. A stale client sending `auto` is migrated to `bypassPermissions`.
export function validateCronjobPermissionMode(agentType: AgentBackendType, raw: string | undefined): CronjobPermissionMode {
  if (agentType === "codex") return "never";
  // Claude + OpenCode: only "bypassPermissions" is unattended-safe.
  if (raw === "bypassPermissions") return "bypassPermissions";
  return "bypassPermissions";
}
