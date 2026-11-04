import { useCallback } from "react";
import type { LogEntry } from "../../../shared/types.ts";
import { useI18n } from "../../i18n.tsx";
import { useAppState } from "../../store.tsx";
import { chatCopyText, type ChatCopyFormat, type ChatCopyScope } from "../chat-copy.ts";
import { describeUserMessageSender } from "../entries/UserMessage.tsx";

// The text the chat header's Copy menu puts on the clipboard, with each
// message's sender named as the chat names it.
export function useChatCopyText(logs: LogEntry[], agentName: string) {
  const translator = useI18n();
  const viewer = useAppState().sessionContext?.username ?? null;
  return useCallback(
    (scope: ChatCopyScope, format: ChatCopyFormat) =>
      chatCopyText(logs, scope, {
        format,
        agentName,
        viewer,
        senderLabel: (entry) => {
          const meta = entry.metadata ?? {};
          const field = (key: string) => (typeof meta[key] === "string" ? (meta[key] as string) : undefined);
          return describeUserMessageSender(
            {
              username: field("username"),
              device: field("device"),
              agentName: field("sender_agent_name"),
              agentRoom: field("sender_agent_room"),
              cronjobName: field("sender_cronjob_name"),
              webhookName: field("sender_webhook_name"),
            },
            translator,
          ).label;
        },
      }),
    [logs, agentName, viewer, translator],
  );
}
