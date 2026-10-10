import type { AgentInfo } from "../../../shared/types.ts";
import { claudeModelCapabilities, claudeModelOverrides } from "../../backends/claude/model-options.ts";

export function sessionModelMetadata(
  info: Pick<AgentInfo, "agentType" | "modelFamily" | "permissionMode">,
  env?: Record<string, string | undefined>,
): Pick<AgentInfo, "claudeModelOverrides" | "effectivePermissionMode"> {
  if (info.agentType !== "claude") return { claudeModelOverrides: undefined, effectivePermissionMode: info.permissionMode };
  return {
    claudeModelOverrides: claudeModelOverrides(env),
    effectivePermissionMode: info.permissionMode === "auto" && !claudeModelCapabilities(info.modelFamily, env).supportsAutoPermission ? "default" : info.permissionMode,
  };
}
