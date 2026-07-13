import type { ClientCommand, ServerMessage } from "../../shared/types.ts";
import * as AgentManager from "../agent-manager.ts";
import { broadcast } from "./broadcast.ts";

export type AgentConversationCommand = Extract<
  ClientCommand,
  | { type: "send_message" }
  | { type: "dequeue_message" }
  | { type: "send_now" }
  | { type: "new_conversation" }
  | { type: "resume" }
  | { type: "set_topic" }
  | { type: "reset_topic" }
  | { type: "list_sessions" }
  | { type: "edit_message" }
>;

export async function handleAgentConversationCommand(cmd: AgentConversationCommand, canUseAgent: (agentId: string) => boolean): Promise<void> {
  if (!canUseAgent(cmd.agentId)) return;
  switch (cmd.type) {
    case "send_message":
      // Don't await -- let it stream in the background.
      AgentManager.sendMessage(cmd.agentId, cmd.text, cmd.username, cmd.attachments);
      return;
    case "dequeue_message":
      AgentManager.dequeueMessage(cmd.agentId, cmd.queuedId);
      return;
    case "send_now":
      AgentManager.sendNow(cmd.agentId).catch((err: any) => {
        console.error(`sendNow failed for ${cmd.agentId}:`, err.message);
      });
      return;
    case "new_conversation":
      await AgentManager.newConversation(cmd.agentId);
      return;
    case "resume":
      await AgentManager.resume(cmd.agentId, cmd.sessionId);
      return;
    case "set_topic":
      AgentManager.setTopic(cmd.agentId, cmd.topic);
      return;
    case "reset_topic":
      AgentManager.resetTopic(cmd.agentId);
      return;
    case "list_sessions": {
      const sessions = AgentManager.listSessions(cmd.agentId);
      const currentSessionId = AgentManager.getCurrentSessionId(cmd.agentId);
      broadcast({
        type: "sessions_list",
        agentId: cmd.agentId,
        sessions,
        currentSessionId,
      } as ServerMessage);
      return;
    }
    case "edit_message":
      // Don't await -- let it stream in the background (like send_message).
      AgentManager.editMessage(cmd.agentId, cmd.logEntryId, cmd.newText, cmd.username);
      return;
  }
}
