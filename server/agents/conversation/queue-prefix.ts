import type { QueuedMessage, QueuedSender } from "../../../shared/types.ts";
import { formatAgentSenderPrefix, formatAppSenderPrefix, formatCronjobSenderPrefix, formatUserPrefix } from "../../../shared/identity.ts";

function senderPrefixText(sender: QueuedSender): string {
  switch (sender.kind) {
    case "user":
      return sender.device ? formatUserPrefix(`${sender.username ?? "User"} (${sender.device})`) : formatUserPrefix(sender.username);
    case "agent":
      return `${formatAgentSenderPrefix(sender.agentId, sender.agentName, sender.roomName)} `;
    case "app":
      return `${formatAppSenderPrefix(sender.appName)} `;
    case "cronjob":
      return `${formatCronjobSenderPrefix(sender.cronjobName)} `;
  }
}

export function flushPrefix(m: QueuedMessage, receiverAgentId: string): string {
  if (m.handoff && m.sender.kind === "agent" && m.sender.agentId === receiverAgentId) return "[Handoff from your previous session] ";
  if (!m.scheduledFor) return senderPrefixText(m.sender);
  return `[Scheduled message for ${new Date(m.scheduledFor).toISOString()}.${m.scheduledSenderGone ? " The sender agent no longer exists." : ""}]\n`;
}
