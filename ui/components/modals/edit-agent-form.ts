import type { AgentBackendType, CodexSandboxMode, EffortLevel } from "../../../shared/types.ts";

// Everything the form can edit, flattened to comparable primitives (outfit as
// JSON). Dirtiness is measured against the RENDERED opening state — the random
// spawn outfit and the auto-corrected permission mode count as the baseline,
// not the persisted agent — so only the user's own edits make the form dirty.
export type EditAgentFormSnapshot = {
  name: string;
  cwd: string;
  outfit: string;
  customInstructions: string;
  modelFamily: string;
  agentType: AgentBackendType;
  permissionMode: string;
  codexSandbox: CodexSandboxMode;
  effort: EffortLevel;
  privileged: boolean;
  managerUserId: string;
};

export function isFormDirty(baseline: EditAgentFormSnapshot, current: EditAgentFormSnapshot): boolean {
  return (
    baseline.name !== current.name ||
    baseline.cwd !== current.cwd ||
    baseline.outfit !== current.outfit ||
    baseline.customInstructions !== current.customInstructions ||
    baseline.modelFamily !== current.modelFamily ||
    baseline.agentType !== current.agentType ||
    baseline.permissionMode !== current.permissionMode ||
    baseline.codexSandbox !== current.codexSandbox ||
    baseline.effort !== current.effort ||
    baseline.privileged !== current.privileged ||
    baseline.managerUserId !== current.managerUserId
  );
}

export function canToggleAgentPrivilege(isSpawn: boolean, sessionContext: { role: "owner" | "member"; userId: string } | null, agent: { userId?: string | null } | undefined): boolean {
  return !isSpawn && (sessionContext?.role === "owner" || (sessionContext?.userId != null && agent?.userId === sessionContext.userId));
}
