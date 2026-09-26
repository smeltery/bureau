import type { PendingPromptKind } from "../../shared/types.ts";
import type { ManagedAgent } from "./state-types.ts";

export function pendingPromptOf(managed: ManagedAgent): PendingPromptKind | null {
  if (managed.pendingPermission || (managed.queuedPermissions?.length ?? 0) > 0) return "permission";
  if (managed.pendingResume) return "resume";
  if (managed.pendingModelPick) return "model";
  if (managed.pendingEffortPick) return "effort";
  if (managed.pendingCronjobPick) return "cronjob";
  return null;
}

export function inMultiStepFlow(managed: ManagedAgent): boolean {
  return pendingPromptOf(managed) !== null;
}
