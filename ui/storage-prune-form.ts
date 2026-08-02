import type { PrunePlanWire, PrunePolicy, PruneTarget } from "../shared/storage-types.ts";

export interface PolicyForm {
  target: PruneTarget;
  olderThanDays: string;
  keepPerAgent: string;
}

const MIN_OLDER_THAN_DAYS = 1;

function parseInteger(raw: string, min: number): number | null {
  if (raw.trim() === "") return null;
  const value = Number(raw);
  return Number.isInteger(value) && value >= min ? value : null;
}

export function previewRequest(form: PolicyForm): PrunePolicy | null {
  const olderThanDays = parseInteger(form.olderThanDays, MIN_OLDER_THAN_DAYS);
  if (olderThanDays === null) return null;

  if (form.target === "attachments") {
    return { target: form.target, olderThanDays };
  }

  const keepPerAgent = parseInteger(form.keepPerAgent, 0);
  if (keepPerAgent === null) return null;
  return { target: form.target, olderThanDays, keepPerAgent };
}

export function applyRequest(plan: PrunePlanWire): PrunePolicy {
  if (plan.target === "attachments") {
    return { target: plan.target, olderThanDays: plan.policy.olderThanDays, apply: true };
  }
  return {
    target: plan.target,
    olderThanDays: plan.policy.olderThanDays,
    keepPerAgent: plan.policy.keepPerAgent,
    apply: true,
  };
}

export function planMatchesForm(plan: PrunePlanWire, form: PolicyForm): boolean {
  const request = previewRequest(form);
  if (!request) return false;
  if (request.target !== plan.target) return false;
  if (request.olderThanDays !== plan.policy.olderThanDays) return false;
  if (request.target === "transcripts" && request.keepPerAgent !== plan.policy.keepPerAgent) return false;
  return true;
}
