import type { LogEntry } from "../../../shared/types.ts";
import { UserMessage, EditableUserMessage } from "./UserMessage.tsx";
import { AssistantText, ThinkingBlock, ErrorBlock, SystemMessage } from "./AssistantEntries.tsx";
import { ToolCall, ToolResult } from "./ToolEntries.tsx";

export { serializeEntries } from "./serialize.ts";

/**
 * Dispatches a `LogEntry` to its kind-specific renderer.
 *
 * Per-kind components live in neighbouring files; shared helpers
 * (`AttachmentDisplay`, `DurationLabel`, `TurnCopyButton`,
 * `FileChip`) live in `./shared.tsx`.
 */
export function LogEntryCard({
  entry,
  isLastInTurn,
  turnEntries,
  isMobile,
  canEdit,
  isEditing,
  onStartEdit,
  onCancelEdit,
  onSubmitEdit,
}: {
  entry: LogEntry;
  isLastInTurn?: boolean;
  turnEntries?: LogEntry[];
  isMobile?: boolean;
  canEdit?: boolean;
  isEditing?: boolean;
  onStartEdit?: (entryId: string) => void;
  onCancelEdit?: () => void;
  onSubmitEdit?: (entryId: string, newText: string) => void;
}) {
  switch (entry.kind) {
    case "user_message": {
      const username = entry.metadata?.username as string | undefined;
      if (isEditing) {
        return <EditableUserMessage content={entry.content} entryId={entry.id} isMobile={isMobile} username={username} onCancel={onCancelEdit} onSubmit={onSubmitEdit} />;
      }
      return <UserMessage content={entry.content} isMobile={isMobile} username={username} attachments={entry.attachments} agentId={entry.agentId} canEdit={canEdit} onEdit={onStartEdit ? () => onStartEdit(entry.id) : undefined} />;
    }
    case "text":
      return (
        <AssistantText
          content={entry.content}
          isLastInTurn={isLastInTurn}
          turnEntries={turnEntries}
          isMobile={isMobile}
        />
      );
    case "thinking": {
      const durationMs = entry.metadata?.duration_ms as number | undefined;
      return (
        <ThinkingBlock
          content={entry.content}
          durationMs={durationMs}
          isLastInTurn={isLastInTurn}
          turnEntries={turnEntries}
          isMobile={isMobile}
        />
      );
    }
    case "tool_call": {
      // Find matching tool_result to get duration
      const toolId = entry.metadata?.toolId;
      const matchingResult = turnEntries?.find(
        (e) => e.kind === "tool_result" && e.metadata?.toolUseId === toolId
      );
      const durationMs = matchingResult?.metadata?.duration_ms as number | undefined;
      return (
        <ToolCall
          name={entry.content}
          input={entry.metadata?.input}
          durationMs={durationMs}
          isLastInTurn={isLastInTurn}
          turnEntries={turnEntries}
          isMobile={isMobile}
        />
      );
    }
    case "tool_result":
      return (
        <ToolResult
          entry={entry}
          isLastInTurn={isLastInTurn}
          turnEntries={turnEntries}
          isMobile={isMobile}
        />
      );
    case "error":
      return (
        <ErrorBlock
          content={entry.content}
          isLastInTurn={isLastInTurn}
          turnEntries={turnEntries}
          isMobile={isMobile}
        />
      );
    case "system":
      return <SystemMessage content={entry.content} isMobile={isMobile} />;
    default:
      return <div style={{ padding: "4px 0", color: "var(--text-muted)", fontSize: isMobile ? 14 : 12 }}>{entry.content}</div>;
  }
}
