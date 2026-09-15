import { useCallback, useState } from "react";
import type { ChoicePromptPayload, LogEntry } from "../../../shared/types.ts";
import { Markdown } from "../Markdown.tsx";
import { CopyButton } from "../../components/controls/CopyButton.tsx";
import { SpeakButton } from "../../components/controls/SpeakButton.tsx";
import { DurationLabel, MessageTimestamp, TurnCopyButton } from "./shared.tsx";
import { serializeEntries } from "./serialize.ts";

const COLLAPSED_TEXT_CHARS = 2400;
const COLLAPSED_TEXT_LINES = 36;
const COLLAPSED_MAX_HEIGHT = 360;

export function shouldCollapseAssistantText(content: string): boolean {
  return content.length > COLLAPSED_TEXT_CHARS || content.split("\n").length > COLLAPSED_TEXT_LINES;
}

export function AssistantText({
  content,
  isLastInTurn,
  turnEntries,
  isMobile,
  timestamp,
}: {
  content: string;
  isLastInTurn?: boolean;
  turnEntries?: LogEntry[];
  isMobile?: boolean;
  timestamp?: number;
}) {
  const getText = useCallback(() => content, [content]);
  const canCollapse = shouldCollapseAssistantText(content);
  const [expanded, setExpanded] = useState(false);
  return (
    <div style={{ margin: "8px 0", padding: "10px 14px", paddingRight: 40, borderRadius: 10, background: "var(--bg-subtle)", position: "relative", fontSize: isMobile ? 15 : undefined }}>
      <div
        style={
          canCollapse && !expanded
            ? {
                maxHeight: COLLAPSED_MAX_HEIGHT,
                overflow: "hidden",
                position: "relative",
              }
            : undefined
        }
      >
        <Markdown content={content} />
        {canCollapse && !expanded && (
          <div
            aria-hidden
            style={{
              position: "absolute",
              left: 0,
              right: 0,
              bottom: 0,
              height: 72,
              background: "linear-gradient(to bottom, rgba(0,0,0,0), var(--bg-subtle))",
              pointerEvents: "none",
            }}
          />
        )}
      </div>
      {canCollapse && (
        <button
          type="button"
          onClick={() => setExpanded((prev) => !prev)}
          aria-expanded={expanded}
          style={{
            marginTop: 8,
            border: "1px solid var(--border-light)",
            borderRadius: 6,
            background: "var(--bg-base)",
            color: "var(--text-muted)",
            cursor: "pointer",
            fontSize: isMobile ? 13 : 12,
            fontFamily: "'DM Sans',sans-serif",
            fontWeight: 600,
            padding: "4px 9px",
          }}
        >
          {expanded ? "Show less" : "Show more"}
        </button>
      )}
      <div style={{ position: "absolute", top: 8, right: 8, display: "flex", alignItems: "center", gap: 8 }}>
        <MessageTimestamp timestamp={timestamp} />
        <div style={{ display: "flex", gap: 4 }}>
          <SpeakButton getText={getText} />
          {isLastInTurn && turnEntries && <CopyButton getText={() => serializeEntries(turnEntries)} />}
        </div>
      </div>
    </div>
  );
}

export function ThinkingBlock({
  content,
  durationMs,
  isLastInTurn,
  turnEntries,
  isMobile,
  timestamp,
}: {
  content: string;
  durationMs?: number;
  isLastInTurn?: boolean;
  turnEntries?: LogEntry[];
  isMobile?: boolean;
  timestamp?: number;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div style={{ margin: "4px 0", position: "relative" }}>
      <button
        onClick={() => setOpen(!open)}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          padding: "4px 8px",
          border: "none",
          background: "transparent",
          color: "var(--text-faint)",
          fontSize: isMobile ? 13 : 11,
          cursor: "pointer",
          width: "100%",
          textAlign: "left",
        }}
      >
        <span style={{ transform: open ? "rotate(90deg)" : "rotate(0deg)", transition: "transform 0.15s", display: "inline-block" }}>&#9654;</span>
        Thinking...
        {durationMs != null && <DurationLabel ms={durationMs} isMobile={isMobile} />}
      </button>
      {open && (
        <div
          style={{
            margin: "4px 0 4px 20px",
            padding: "8px 12px",
            borderRadius: 8,
            background: "var(--thinking-bg)",
            borderLeft: "2px solid var(--thinking-border)",
            color: "var(--text-faint)",
            fontSize: isMobile ? 14 : 12,
            fontFamily: "'JetBrains Mono',monospace",
            lineHeight: 1.6,
            whiteSpace: "pre-wrap",
            maxHeight: 300,
            overflowY: "auto",
            overflowWrap: "break-word",
            wordBreak: "break-word",
          }}
        >
          {content}
        </div>
      )}
      <TurnCopyButton turnEntries={isLastInTurn ? turnEntries : undefined} timestamp={timestamp} />
    </div>
  );
}

export function ErrorBlock({ content, isLastInTurn, turnEntries, isMobile, timestamp }: { content: string; isLastInTurn?: boolean; turnEntries?: LogEntry[]; isMobile?: boolean; timestamp?: number }) {
  return (
    <div
      style={{
        margin: "8px 0",
        padding: "10px 14px",
        borderRadius: 8,
        background: "var(--red-bg)",
        borderLeft: "3px solid var(--red)",
        color: "var(--red)",
        fontSize: isMobile ? 14 : 12,
        fontFamily: "'JetBrains Mono',monospace",
        lineHeight: 1.5,
        whiteSpace: "pre-wrap",
        overflowWrap: "break-word",
        wordBreak: "break-word",
        position: "relative",
      }}
    >
      {content}
      <TurnCopyButton turnEntries={isLastInTurn ? turnEntries : undefined} timestamp={timestamp} />
    </div>
  );
}

export function SystemMessage({ content, isMobile, openConnections, onOpenConnections }: { content: string; isMobile?: boolean; openConnections?: boolean; onOpenConnections?: () => void }) {
  const isMultiline = content.includes("\n");
  return (
    <div
      style={{
        margin: "8px 0",
        padding: "6px 0",
        textAlign: isMultiline ? "left" : "center",
        color: isMultiline ? "var(--text-dim)" : "var(--text-ghost)",
        fontSize: isMultiline ? (isMobile ? 15 : 13) : isMobile ? 13 : 11,
        fontFamily: isMultiline ? "'JetBrains Mono',monospace" : undefined,
        fontStyle: isMultiline ? "normal" : "italic",
        ...(!isMultiline && { whiteSpace: "pre-wrap" }),
      }}
    >
      {isMultiline ? <Markdown content={content} /> : content}
      {openConnections && onOpenConnections && (
        <div style={{ marginTop: 10, textAlign: "left" }}>
          <button
            type="button"
            onClick={onOpenConnections}
            style={{
              padding: "7px 14px",
              borderRadius: 8,
              border: "1px solid var(--accent)",
              background: "var(--btn-surface)",
              color: "var(--text-primary)",
              fontSize: isMobile ? 13 : 12,
              cursor: "pointer",
            }}
          >
            Open Connections
          </button>
        </div>
      )}
    </div>
  );
}

export function ChoicePromptCard({ prompt, isMobile, onPick }: { prompt: ChoicePromptPayload; isMobile?: boolean; onPick?: (position: number) => void }) {
  return (
    <div
      style={{
        margin: "8px 0",
        padding: "10px 12px",
        borderRadius: 8,
        background: "var(--bg-subtle)",
        border: "1px solid var(--border-dim)",
        color: "var(--text-primary)",
        fontSize: isMobile ? 14 : 13,
      }}
    >
      <div style={{ fontWeight: 700, marginBottom: 8 }}>{prompt.title}</div>
      <div style={{ display: "grid", gap: 6 }}>
        {prompt.choices.map((choice, index) => (
          <button
            key={`${choice.value}-${index}`}
            type="button"
            disabled={!onPick}
            onClick={() => onPick?.(index + 1)}
            style={{
              display: "grid",
              gridTemplateColumns: "2.5ch minmax(0, 1fr)",
              gap: 8,
              alignItems: "baseline",
              padding: "7px 8px",
              borderRadius: 6,
              background: choice.current ? "var(--bg-code)" : "var(--bg-base)",
              border: choice.current ? "1px solid var(--accent)" : "1px solid var(--border-dim)",
              color: "inherit",
              cursor: onPick ? "pointer" : "default",
              textAlign: "left",
            }}
          >
            <span style={{ fontVariantNumeric: "tabular-nums", color: "var(--text-muted)", textAlign: "right" }}>{index + 1}.</span>
            <span style={{ minWidth: 0 }}>
              <span style={{ fontWeight: 600, overflowWrap: "anywhere" }}>
                {choice.label}
                {choice.current ? " (current)" : ""}
              </span>
              {choice.description && <span style={{ display: "block", color: "var(--text-dim)", fontSize: isMobile ? 12 : 11, marginTop: 2, overflowWrap: "anywhere" }}>{choice.description}</span>}
            </span>
          </button>
        ))}
      </div>
      <div style={{ marginTop: 8, color: "var(--text-dim)", fontSize: isMobile ? 12 : 11 }}>{prompt.instruction}</div>
    </div>
  );
}

export function TaskBreadcrumb({ content, phase, isMobile }: { content: string; phase?: unknown; isMobile?: boolean }) {
  const dotColor = phase === "failed" ? "var(--red)" : phase === "completed" ? "var(--green)" : "var(--text-ghost)";
  return (
    <div
      style={{
        margin: "8px 0",
        padding: "6px 0",
        textAlign: "center",
        color: "var(--text-ghost)",
        fontSize: isMobile ? 13 : 11,
        fontStyle: "italic",
      }}
    >
      <span
        style={{
          display: "inline-block",
          width: 6,
          height: 6,
          borderRadius: "50%",
          background: dotColor,
          marginRight: 6,
          verticalAlign: "middle",
        }}
      />
      {content}
    </div>
  );
}

export function PermissionDeniedCard({ denial, isMobile }: { denial: { toolName?: string; message?: string; decisionReason?: string }; isMobile?: boolean }) {
  const reason = denial.decisionReason || denial.message;
  return (
    <div
      style={{
        margin: "8px 0",
        padding: "6px 10px",
        borderLeft: "3px solid var(--red)",
        borderRadius: 4,
        background: "var(--bg-code)",
        fontSize: isMobile ? 13 : 12,
        display: "flex",
        gap: 6,
        alignItems: "baseline",
        flexWrap: "wrap",
      }}
      title={denial.message}
    >
      <span style={{ color: "var(--red)", fontWeight: 600, flexShrink: 0 }}>Denied</span>
      {denial.toolName && <span style={{ color: "var(--text-primary)", fontFamily: "'JetBrains Mono',monospace", fontWeight: 600, flexShrink: 0 }}>{denial.toolName}</span>}
      {reason && <span style={{ color: "var(--text-dim)", overflowWrap: "anywhere" }}>{reason}</span>}
    </div>
  );
}
