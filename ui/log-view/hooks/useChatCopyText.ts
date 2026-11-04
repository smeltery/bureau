import { useCallback } from "react";
import type { LogEntry } from "../../../shared/types.ts";
import { useI18n } from "../../i18n.tsx";
import { useAppState } from "../../store.tsx";
import { chatCopyText, type ChatCopyScope } from "../header/chat-copy.ts";
import { chatHtmlDocument, chatHtmlFileName, type ChatCopyGetter, type ChatCopyOutput } from "../header/chat-html.ts";
import { describeUserMessageSender } from "../entries/UserMessage.tsx";

// What the chat header's Copy menu produces: clipboard text, or the page of an
// HTML file. Each message's sender is named as the chat names it.
export function useChatCopyText(logs: LogEntry[], agentName: string): ChatCopyGetter {
  const translator = useI18n();
  const viewer = useAppState().sessionContext?.username ?? null;
  return useCallback(
    (scope: ChatCopyScope, output: ChatCopyOutput) => {
      const senderLabel = (entry: LogEntry) => {
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
      };
      if (output !== "html") return { text: chatCopyText(logs, scope, { format: output, agentName, viewer, senderLabel }) };
      const exportedAt = new Date();
      const dateLabel = new Intl.DateTimeFormat(translator.language, { dateStyle: "medium", timeStyle: "short" }).format(exportedAt);
      return {
        text: chatHtmlDocument(logs, scope, { agentName, viewer, senderLabel, language: translator.language, exportedAt, dateLabel }),
        fileName: chatHtmlFileName(agentName, exportedAt),
      };
    },
    [logs, agentName, viewer, translator],
  );
}
