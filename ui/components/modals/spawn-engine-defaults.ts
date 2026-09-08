import type { AgentBackendType, AgentPermissionMode, CodexSandboxMode, EffortLevel } from "../../../shared/types.ts";
import { CODEX_MODELS, DEFAULT_EFFORT, effortLevelsFor, MODEL_FAMILIES, OPENCODE_MODELS } from "../../../shared/types.ts";

export function snapEffort(engine: AgentBackendType, family: string, current: EffortLevel): EffortLevel {
  return effortLevelsFor(engine, family).some((o) => o.level === current) ? current : DEFAULT_EFFORT;
}

/** Apply engine-specific defaults when the spawn dialog switches backends. */
export function applySpawnEngineDefaults(
  agentType: AgentBackendType,
  modelFamily: string,
  setModelFamily: (fn: (c: string) => string) => void,
  setPermissionMode: (fn: (c: AgentPermissionMode) => AgentPermissionMode) => void,
  setCodexSandbox: (fn: (c: CodexSandboxMode) => CodexSandboxMode) => void,
  setEffort: (fn: (c: EffortLevel) => EffortLevel) => void,
): void {
  if (agentType === "codex") {
    setModelFamily((c) => (CODEX_MODELS.some((m) => m.value === c) ? c : CODEX_MODELS[0].value));
    setPermissionMode((c) => (c === "never" || c === "on-request" || c === "untrusted" ? c : "never"));
    setCodexSandbox((c) => c ?? "danger-full-access");
    setEffort((c) => snapEffort("codex", modelFamily, c));
    return;
  }
  if (agentType === "opencode") {
    setModelFamily((c) => (c.includes("/") ? c : OPENCODE_MODELS[0].value));
    setPermissionMode((c) => (c === "default" || c === "bypassPermissions" ? c : "default"));
    setEffort((c) => snapEffort("opencode", modelFamily, c));
    return;
  }
  setModelFamily((c) => (MODEL_FAMILIES.some((m) => m.family === c) ? c : MODEL_FAMILIES[0].family));
  setPermissionMode((c) => (c === "auto" || c === "default" || c === "acceptEdits" || c === "bypassPermissions" ? c : "auto"));
  setEffort((c) => snapEffort("claude", modelFamily, c));
}
