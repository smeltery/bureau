import type { ChoicePromptPayload, LogEntry } from "../../../shared/types.ts";
import { UserMessage, EditableUserMessage } from "./UserMessage.tsx";
import { AssistantText, ThinkingBlock, ErrorBlock, SystemMessage, TaskBreadcrumb, PermissionDeniedCard, ChoicePromptCard } from "./AssistantEntries.tsx";
import { findMatchingToolResult, isFoldedToolResult, ToolCall, ToolResult } from "./ToolEntries.tsx";
import { subagentOf } from "./subagentOrigin.ts";
import { DiffCard } from "../DiffCard.tsx";
import { EditRequestCard } from "../EditRequestCard.tsx";
import { FileViewCard } from "../FileViewCard.tsx";
import { TerminalCommandCard } from "../TerminalCommandCard.tsx";
import { isApiTokenDevice } from "../../../shared/identity.ts";

export { serializeEntries } from "./serialize.ts";
export { isFoldedToolResult } from "./ToolEntries.tsx";

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
  onOpenInEditor,
  onCopyToTerminal,
  onChoicePick,
  onOpenConnections,
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
  onOpenInEditor?: (path: string) => void;
  onCopyToTerminal?: (command: string) => void;
  onChoicePick?: (kind: ChoicePromptPayload["kind"], position: number) => void;
  onOpenConnections?: () => void;
}) {
  switch (entry.kind) {
    case "user_message": {
      const username = entry.metadata?.username as string | undefined;
      const device = entry.metadata?.device as string | undefined;
      const agentName = entry.metadata?.sender_agent_name as string | undefined;
      const agentRoom = entry.metadata?.sender_agent_room as string | undefined;
      const cronjobName = entry.metadata?.sender_cronjob_name as string | undefined;
      const isProgrammaticUser = isApiTokenDevice(device);
      // Agent-sent messages aren't editable: "edit & branch" rewrites the
      // human's own prompt, not a peer-attributed message.
      if (isEditing && !agentName && !cronjobName && !isProgrammaticUser) {
        return <EditableUserMessage content={entry.content} entryId={entry.id} isMobile={isMobile} username={username} onCancel={onCancelEdit} onSubmit={onSubmitEdit} />;
      }
      return (
        <UserMessage
          content={entry.content}
          isMobile={isMobile}
          username={username}
          device={device}
          agentName={agentName}
          agentRoom={agentRoom}
          cronjobName={cronjobName}
          attachments={entry.attachments}
          agentId={entry.agentId}
          canEdit={canEdit && !agentName && !cronjobName && !isProgrammaticUser}
          onEdit={onStartEdit ? () => onStartEdit(entry.id) : undefined}
        />
      );
    }
    case "api_token_outbound": {
      const recipient = entry.metadata?.recipient_api_token_name;
      return (
        <UserMessage
          content={entry.content}
          isMobile={isMobile}
          device={typeof recipient === "string" ? `To remote boss "${recipient}"` : "To remote boss"}
          fromNonHuman
          outgoing
          agentId={entry.agentId}
          canEdit={false}
        />
      );
    }
    case "text":
      return <AssistantText content={entry.content} isLastInTurn={isLastInTurn} turnEntries={turnEntries} isMobile={isMobile} />;
    case "thinking": {
      const durationMs = entry.metadata?.duration_ms as number | undefined;
      return <ThinkingBlock content={entry.content} durationMs={durationMs} isLastInTurn={isLastInTurn} turnEntries={turnEntries} isMobile={isMobile} />;
    }
    case "tool_call": {
      const matchingResult = findMatchingToolResult(entry, turnEntries);
      const durationMs = matchingResult?.metadata?.duration_ms as number | undefined;
      const resultIsError = matchingResult?.metadata?.isError === true;
      return (
        <ToolCall
          name={entry.content}
          input={entry.metadata?.input}
          hasResult={matchingResult != null}
          resultContent={matchingResult?.content}
          resultIsError={resultIsError}
          durationMs={durationMs}
          subagent={subagentOf(entry)}
          isLastInTurn={isLastInTurn}
          turnEntries={turnEntries}
          isMobile={isMobile}
        />
      );
    }
    case "tool_result": {
      if (isFoldedToolResult(entry, turnEntries)) return null;
      return <ToolResult entry={entry} isLastInTurn={isLastInTurn} turnEntries={turnEntries} isMobile={isMobile} />;
    }
    case "error":
      return <ErrorBlock content={entry.content} isLastInTurn={isLastInTurn} turnEntries={turnEntries} isMobile={isMobile} />;
    case "system":
      if (entry.metadata?.permissionDenied && typeof entry.metadata.permissionDenied === "object") {
        return <PermissionDeniedCard denial={entry.metadata.permissionDenied as { toolName?: string; message?: string; decisionReason?: string }} isMobile={isMobile} />;
      }
      if (entry.metadata?.taskEvent && typeof entry.metadata.taskEvent === "object") {
        return <TaskBreadcrumb content={entry.content} phase={(entry.metadata.taskEvent as { phase?: unknown }).phase} isMobile={isMobile} />;
      }
      if (entry.metadata?.choicePrompt) {
        const prompt = entry.metadata.choicePrompt;
        return <ChoicePromptCard prompt={prompt} isMobile={isMobile} onPick={onChoicePick ? (position) => onChoicePick(prompt.kind, position) : undefined} />;
      }
      return (
        <SystemMessage
          content={entry.content}
          isMobile={isMobile}
          openConnections={entry.metadata?.openConnections === true}
          onOpenConnections={entry.metadata?.openConnections === true ? onOpenConnections : undefined}
        />
      );
    case "diff": {
      if (!entry.diff) return <SystemMessage content={entry.content} isMobile={isMobile} />;
      return <DiffCard payload={entry.diff} />;
    }
    case "edit-request": {
      if (!entry.file || !onOpenInEditor) return <SystemMessage content={entry.content} isMobile={isMobile} />;
      return <EditRequestCard payload={entry.file} onOpen={onOpenInEditor} />;
    }
    case "terminal-command": {
      if (!entry.terminal || !onCopyToTerminal) return <SystemMessage content={entry.content} isMobile={isMobile} />;
      return <TerminalCommandCard payload={entry.terminal} onCopy={onCopyToTerminal} />;
    }
    case "file-view": {
      if (!entry.attachments || entry.attachments.length === 0) return <SystemMessage content={entry.content} isMobile={isMobile} />;
      return <FileViewCard attachments={entry.attachments} agentId={entry.agentId} isMobile={isMobile} />;
    }
    default:
      return <div style={{ padding: "4px 0", color: "var(--text-muted)", fontSize: isMobile ? 14 : 12 }}>{entry.content}</div>;
  }
}
