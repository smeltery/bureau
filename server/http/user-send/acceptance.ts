import type { Attachment } from "../../../shared/types.ts";
import * as AgentManager from "../../agent-manager.ts";
import { createUserSendDedupe, type UserSendAcceptance } from "../../agents/conversation/user-send-dedupe.ts";

const userSendDedupe = createUserSendDedupe();

export async function acceptUserSend(
  agentId: string,
  text: string,
  username: string | undefined,
  attachments: Attachment[] | undefined,
  userId: string | null,
  clientMessageId: string | undefined,
): Promise<UserSendAcceptance> {
  if (!clientMessageId) {
    await AgentManager.sendMessage(agentId, text, username, attachments, userId);
    return { ok: true };
  }
  if (clientMessageId.length > 128) return { ok: false, status: 422, error: "clientMessageId is too long" };
  const claim = userSendDedupe.claim(agentId, clientMessageId);
  if (claim.kind === "accepted") return { ok: true };
  if (claim.kind === "in_flight") return claim.wait;
  try {
    await AgentManager.sendMessage(agentId, text, username, attachments, userId);
    const result: UserSendAcceptance = { ok: true };
    claim.settle(result);
    return result;
  } catch (err) {
    const result: UserSendAcceptance = { ok: false, status: 500, error: err instanceof Error ? err.message : "send failed" };
    claim.settle(result);
    return result;
  }
}
