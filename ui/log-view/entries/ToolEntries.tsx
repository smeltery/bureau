import { useState } from "react";
import type { LogEntry, SubagentOrigin } from "../../../shared/types.ts";
import { summarizeBureauCurl } from "./bureau-curl.ts";
import { AttachmentDisplay, DurationLabel, TurnCopyButton } from "./shared.tsx";
import { subagentOf, subagentPillLabel, subagentPillTitle } from "./subagentOrigin.ts";

function extractToolSummary(toolName: string, input: unknown): string {
  if (!input || typeof input !== "object") return "";
  const obj = input as Record<string, unknown>;
  switch (toolName) {
    case "Bash":
      return typeof obj.command === "string" ? (summarizeBureauCurl(obj.command) ?? obj.command.slice(0, 80)) : "";
    case "Read":
      return typeof obj.file_path === "string" ? obj.file_path : "";
    case "Write":
    case "Edit":
      return typeof obj.file_path === "string" ? obj.file_path : extractChangePaths(obj.changes);
    case "Glob":
      return typeof obj.pattern === "string" ? obj.pattern : "";
    case "Grep":
      return typeof obj.pattern === "string" ? obj.pattern : "";
    case "WebSearch":
      return typeof obj.query === "string" ? obj.query : "";
    default:
      return typeof obj.description === "string" ? obj.description.slice(0, 60) : "";
  }
}

function extractChangePaths(changes: unknown): string {
  if (!Array.isArray(changes)) return "";
  const paths = changes
    .map((change) => {
      if (!change || typeof change !== "object") return "";
      const path = (change as { path?: unknown }).path;
      return typeof path === "string" ? path : "";
    })
    .filter(Boolean);
  if (paths.length === 0) return "";
  return paths.length === 1 ? paths[0] : `${paths[0]} +${paths.length - 1} more`;
}

export function isFoldedToolResult(entry: LogEntry, turnEntries: LogEntry[] | undefined): boolean {
  if (entry.kind !== "tool_result") return false;
  if ((entry.attachments?.length ?? 0) > 0) return false;
  if (entry.metadata?.isError === true) return false;
  const toolUseId = entry.metadata?.toolUseId;
  if (!toolUseId || !turnEntries) return false;
  return turnEntries.some((e) => e.kind === "tool_call" && e.metadata?.toolId === toolUseId);
}

export function findMatchingToolResult(toolCallEntry: LogEntry, turnEntries: LogEntry[] | undefined): LogEntry | undefined {
  const toolId = toolCallEntry.metadata?.toolId;
  if (!toolId || !turnEntries) return undefined;
  return turnEntries.find((e) => e.kind === "tool_result" && e.metadata?.toolUseId === toolId);
}

/**
 * Marks a card as a subagent's work. Claude's Agent tool runs its own tool
 * calls and the SDK forwards them on the parent's stream, so without this the
 * subagent's Bash/Read run reads as the agent's own.
 */
function SubagentPill({ origin, isMobile }: { origin: SubagentOrigin; isMobile?: boolean }) {
  return (
    <span
      title={subagentPillTitle(origin)}
      style={{
        flexShrink: 0,
        maxWidth: isMobile ? 120 : 160,
        overflow: "hidden",
        textOverflow: "ellipsis",
        padding: "0 5px",
        borderRadius: 4,
        border: "1px solid var(--border-light)",
        background: "var(--bg-subtle)",
        color: "var(--text-dim)",
        fontSize: isMobile ? 11 : 10,
        fontWeight: 500,
        whiteSpace: "nowrap",
      }}
    >
      {subagentPillLabel(origin)}
    </span>
  );
}

export function ToolCall({
  name,
  input,
  hasResult,
  resultContent,
  resultIsError,
  durationMs,
  subagent,
  isLastInTurn,
  turnEntries,
  isMobile,
}: {
  name: string;
  input: unknown;
  hasResult?: boolean;
  resultContent?: string;
  resultIsError?: boolean;
  durationMs?: number;
  subagent?: SubagentOrigin;
  isLastInTurn?: boolean;
  turnEntries?: LogEntry[];
  isMobile?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const inputStr = typeof input === "string" ? input : JSON.stringify(input, null, 2);
  const summary = extractToolSummary(name, input);
  const borderColor = resultIsError ? "var(--red)" : "var(--green-border)";
  const bgColor = resultIsError ? "var(--red-bg)" : "var(--tool-call-bg)";
  const textColor = resultIsError ? "var(--red)" : "var(--green)";

  return (
    <div
      style={{
        margin: "2px 0",
        position: "relative",
        // Subagent calls step in behind a rule, so a run of them reads as one
        // block instead of as the agent's own work interleaved at top level.
        ...(subagent && { marginLeft: 12, paddingLeft: 8, borderLeft: "2px solid var(--border-light)" }),
      }}
    >
      <button
        onClick={() => setOpen(!open)}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          padding: "3px 10px",
          paddingRight: isLastInTurn ? 40 : 10,
          border: `1px solid ${borderColor}`,
          borderRadius: 6,
          background: bgColor,
          color: textColor,
          fontSize: isMobile ? 14 : 12,
          cursor: "pointer",
          fontFamily: "'JetBrains Mono',monospace",
          width: "100%",
          textAlign: "left",
        }}
      >
        <span style={{ transform: open ? "rotate(90deg)" : "rotate(0deg)", transition: "transform 0.15s", display: "inline-block", fontSize: 8 }}>&#9654;</span>
        {subagent && <SubagentPill origin={subagent} isMobile={isMobile} />}
        <span style={{ fontWeight: 600 }}>{name}</span>
        {summary && (
          <span style={{ color: "var(--text-faint)", marginLeft: 4, fontSize: isMobile ? 13 : 11, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1 }}>{summary}</span>
        )}
        {durationMs != null && <DurationLabel ms={durationMs} isMobile={isMobile} />}
      </button>
      {open && (
        <div
          style={{
            margin: "2px 0 2px 20px",
            padding: "8px 10px",
            borderRadius: 6,
            background: "var(--tool-open-bg)",
            fontSize: isMobile ? 13 : 11,
            fontFamily: "'JetBrains Mono',monospace",
            color: "var(--text-dim)",
            lineHeight: 1.5,
            maxHeight: 300,
            overflowY: "auto",
            overflowX: "auto",
            maxWidth: "100%",
          }}
        >
          <SectionLabel text="Input" isMobile={isMobile} />
          <div style={{ whiteSpace: "pre-wrap" }}>{inputStr}</div>
          {hasResult && (
            <>
              <SectionLabel text="Output" isMobile={isMobile} isError={resultIsError} marginTop={10} />
              {resultContent && resultContent.length > 0 ? (
                <div style={{ whiteSpace: "pre-wrap" }}>{resultContent}</div>
              ) : (
                <div style={{ color: "var(--text-ghost)", fontStyle: "italic" }}>(no output)</div>
              )}
            </>
          )}
        </div>
      )}
      {isLastInTurn && <TurnCopyButton turnEntries={turnEntries} />}
    </div>
  );
}

function SectionLabel({ text, isMobile, isError, marginTop }: { text: string; isMobile?: boolean; isError?: boolean; marginTop?: number }) {
  return (
    <div
      style={{
        fontSize: isMobile ? 11 : 9,
        fontWeight: 600,
        textTransform: "uppercase",
        letterSpacing: "0.05em",
        color: isError ? "var(--red)" : "var(--text-faint)",
        marginBottom: 4,
        marginTop: marginTop ?? 0,
      }}
    >
      {text}
    </div>
  );
}

export function ToolResult({ entry, isLastInTurn, turnEntries, isMobile }: { entry: LogEntry; isLastInTurn?: boolean; turnEntries?: LogEntry[]; isMobile?: boolean }) {
  const [open, setOpen] = useState(false);
  const [echoOpen, setEchoOpen] = useState(false);
  const [lightboxSrc, setLightboxSrc] = useState<string | null>(null);
  const content = entry.content;
  const isLong = content.length > 200;
  const preview = isLong ? content.slice(0, 150) + "..." : content;
  const isError = entry.metadata?.isError === true;
  const matchingToolCall = entry.metadata?.toolUseId != null ? turnEntries?.find((e) => e.kind === "tool_call" && e.metadata?.toolId === entry.metadata?.toolUseId) : undefined;
  const hasMatchingToolCall = !!matchingToolCall;
  const showText = !hasMatchingToolCall || isError;
  const borderColor = isError ? "var(--red)" : "var(--green-border)";
  const textColor = isError ? "var(--red)" : "var(--text-dim)";
  // Only unpaired or errored results reach this branch; the rest fold into
  // their tool_call card, which carries the pill itself.
  const subagent = subagentOf(entry);
  const calledPath = (matchingToolCall?.metadata?.input as { file_path?: unknown } | undefined)?.file_path;
  const calledFilename = typeof calledPath === "string" ? calledPath.split(/[\\/]/).pop() : null;
  const isAttachmentEcho =
    matchingToolCall?.content === "Read" &&
    typeof calledPath === "string" &&
    calledPath.includes(`/logs/${entry.agentId}/files/`) &&
    (entry.attachments ?? []).length > 0 &&
    (entry.attachments ?? []).every((attachment) => attachment.mediaType.startsWith("image/") && (!calledFilename || attachment.filename === calledFilename));

  return (
    <div
      style={{
        margin: "2px 0 8px 20px",
        padding: "6px 10px",
        borderRadius: 6,
        background: "var(--tool-result-bg)",
        borderLeft: `2px solid ${borderColor}`,
        fontSize: isMobile ? 13 : 11,
        fontFamily: "'JetBrains Mono',monospace",
        color: textColor,
        lineHeight: 1.5,
        position: "relative",
        // Line up under the indented subagent tool_call card above it.
        ...(subagent && { marginLeft: 32 }),
      }}
    >
      {subagent && (
        <div style={{ marginBottom: 4 }}>
          <SubagentPill origin={subagent} isMobile={isMobile} />
        </div>
      )}
      {showText && content && <div style={{ whiteSpace: "pre-wrap", overflowX: "auto", maxWidth: "100%" }}>{open ? content : preview}</div>}
      {showText && isLong && (
        <button
          onClick={() => setOpen(!open)}
          style={{
            marginTop: 4,
            padding: "2px 6px",
            border: "none",
            background: "var(--expand-btn)",
            borderRadius: 4,
            color: "var(--text-faint)",
            fontSize: isMobile ? 12 : 10,
            cursor: "pointer",
          }}
        >
          {open ? "Show less" : "Show more"}
        </button>
      )}
      {entry.attachments &&
        entry.attachments.length > 0 &&
        (isAttachmentEcho && !echoOpen ? (
          <button
            onClick={() => setEchoOpen(true)}
            title="The agent viewed an image attached earlier in this chat. Click to show it."
            style={{
              display: "block",
              marginTop: showText && content ? 6 : 0,
              padding: "2px 8px",
              border: "1px solid var(--border-light)",
              background: "var(--expand-btn)",
              borderRadius: 4,
              color: "var(--text-faint)",
              fontSize: isMobile ? 12 : 10,
              cursor: "pointer",
            }}
          >
            Viewed {entry.attachments.length === 1 ? entry.attachments[0].originalName : `${entry.attachments.length} attached images`} (click to show)
          </button>
        ) : (
          <AttachmentDisplay attachments={entry.attachments} agentId={entry.agentId} isMobile={isMobile} lightboxSrc={lightboxSrc} setLightboxSrc={setLightboxSrc} hasContent={showText && !!content} />
        ))}
      {isLastInTurn && <TurnCopyButton turnEntries={turnEntries} />}
    </div>
  );
}
