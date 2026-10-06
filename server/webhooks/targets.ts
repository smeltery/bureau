import type { Webhook } from "../../shared/integrations/webhooks.ts";
import type { UserRecord } from "../../shared/types.ts";
import * as Agents from "../agent-manager.ts";
import * as Jobs from "../cronjobs/index.ts";
import { canManageSchedule, canViewSchedule } from "../cronjobs/access.ts";
import { canSeeRoom, getUserById } from "../users.ts";
import { enqueueMessage } from "../agents/conversation/message-queue.ts";

export function canUseWebhookTarget(user: UserRecord, target: Webhook["target"], manage: boolean): boolean {
  if (target.kind === "schedule") {
    const job = Jobs.listCronjobs().find((item) => item.id === target.id);
    return !!job && (manage ? canManageSchedule(user, job) : canViewSchedule(user, job));
  }
  const agent = Agents.getAgent(target.id);
  if (!agent) return false;
  return canSeeRoom(user, Agents.getRooms()[agent.room]?.id) && (!manage || user.role === "owner" || agent.userId === user.id);
}

export function dispatchWebhook(hook: Webhook, data: string, deliveryId: string): string {
  const owner = getUserById(hook.userId);
  if (!owner || !canUseWebhookTarget(owner, hook.target, true)) throw new Error("target access revoked or target unavailable");
  if (hook.target.kind === "schedule") {
    const run = Jobs.runCronjobWebhook(hook.target.id, data, hook.id, deliveryId);
    if (!run) throw new Error("schedule unavailable");
    return run.id;
  }
  const result = enqueueMessage(hook.target.id, { sender: { kind: "webhook", webhookId: hook.id, webhookName: hook.name }, text: data, clientMessageId: `webhook:${hook.id}:${deliveryId}` });
  if (!result.ok) throw new Error("agent could not accept the delivery");
  return result.messageId;
}
