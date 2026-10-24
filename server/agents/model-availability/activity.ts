import type { AgentInfo } from "../../../shared/types.ts";

const revisions = new WeakMap<object, number>();
let request: (agentId: string) => void = () => {};
export const modelCheckRevision = (target: object): number => revisions.get(target) ?? 0;

export function invalidateModelAvailability(target: { info: AgentInfo }, changes: Partial<AgentInfo>): void {
  if (!["agentType", "modelFamily", "userId", "cwd", "room"].some((key) => Object.hasOwn(changes, key))) return;
  revisions.set(target, modelCheckRevision(target) + 1);
  if (target.info.unavailableModel == null) return;
  target.info.unavailableModel = null;
  changes.unavailableModel = null;
}

export function requestModelAvailability(agentId: string): void {
  request(agentId);
}

export function installModelAvailabilityRequests(handler: typeof request): () => void {
  const previous = request;
  request = handler;
  return () => {
    request = previous;
  };
}
