import { agents, rooms } from "../state.ts";
import type { QueuedMessage, QueuedSender } from "../../../shared/types.ts";
import { formatAgentSenderPrefix, formatAppSenderPrefix, formatCronjobSenderPrefix, formatUserPrefix } from "../../../shared/identity.ts";

function senderPrefixText(sender: QueuedSender, receiverAgentId: string): string {
  switch (sender.kind) {
    case "webhook":
      return `[Webhook ${JSON.stringify(sender.webhookName)}] `;
    case "user":
      return sender.device ? formatUserPrefix(`${sender.username ?? "User"} (${sender.device})`) : formatUserPrefix(sender.username);
    case "agent": {
      const live = agents.get(sender.agentId)?.info;
      const receiver = agents.get(receiverAgentId)?.info;
      const manager = live?.userId && receiver?.userId ? (live.userId === receiver.userId ? "same" : "different") : "unknown";
      return `${formatAgentSenderPrefix(sender.agentId, live?.name ?? sender.agentName, live ? (rooms[live.room]?.name ?? sender.roomName) : sender.roomName, { manager, privileged: !!live?.privileged })} `;
    }
    case "app":
      return `${formatAppSenderPrefix(sender.appName)} `;
    case "cronjob":
      return `${formatCronjobSenderPrefix(sender.cronjobName)} `;
  }
}

export function flushPrefix(m: QueuedMessage, receiverAgentId: string): string {
  if (m.usageResume && m.sender.kind === "agent" && m.sender.agentId === receiverAgentId) return "";
  if (m.handoff && m.sender.kind === "agent" && m.sender.agentId === receiverAgentId) return "[Handoff from your previous session] ";
  if (!m.scheduledFor) return senderPrefixText(m.sender, receiverAgentId);
  return `[Scheduled message for ${new Date(m.scheduledFor).toISOString()}.${m.scheduledSenderGone ? " The sender agent no longer exists." : ""}]\n${senderPrefixText(m.sender, receiverAgentId)}`;
}
