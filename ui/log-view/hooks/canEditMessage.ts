import type { AgentInfo } from "../../../shared/types.ts";

// Editing and unrestricted conversation forking are separate capabilities.
// Older persisted records without capabilities retain the server-checked path.
export function canEditMessage(agent: Pick<AgentInfo, "state" | "capabilities">, opts: { isUserMessage: boolean; alreadyEditing: boolean }): boolean {
  if (!opts.isUserMessage || opts.alreadyEditing) return false;
  if (agent.state !== "waiting_for_response" && agent.state !== "stopped") return false;
  return agent.capabilities?.edit !== false;
}
