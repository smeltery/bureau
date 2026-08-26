import type { PendingPromptKind } from "../../shared/types.ts";
import type { ManagedAgent } from "./state-types.ts";

export function pendingPromptOf(managed: ManagedAgent): PendingPromptKind | null {
  if (managed.pendingPermission) return "permission";
  if (managed.pendingResume) return "resume";
  if (managed.pendingModelPick) return "model";
  if (managed.pendingEffortPick) return "effort";
  return null;
}

export function inMultiStepFlow(managed: ManagedAgent): boolean {
  return pendingPromptOf(managed) !== null;
}
