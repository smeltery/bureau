import { useCallback, useState } from "react";
import type { ChoicePromptPayload, LogEntry } from "../../../shared/types.ts";
import { Markdown } from "../Markdown.tsx";
import { CopyButton } from "../../components/controls/CopyButton.tsx";
import { SpeakButton } from "../../components/controls/SpeakButton.tsx";
import { DurationLabel, TurnCopyButton } from "./shared.tsx";
import { serializeEntries } from "./serialize.ts";

export function AssistantText({ content, isLastInTurn, turnEntries, isMobile }: { content: string; isLastInTurn?: boolean; turnEntries?: LogEntry[]; isMobile?: boolean }) {
  const getText = useCallback(() => content, [content]);
  return (
    <div style={{ margin: "8px 0", padding: "10px 14px", paddingRight: 40, borderRadius: 10, background: "var(--bg-subtle)", position: "relative", fontSize: isMobile ? 15 : undefined }}>
      <Markdown content={content} />
      <div style={{ position: "absolute", top: 8, right: 8, display: "flex", gap: 4 }}>
        <SpeakButton getText={getText} />
        {isLastInTurn && turnEntries && <CopyButton getText={() => serializeEntries(turnEntries)} />}
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
}: {
  content: string;
  durationMs?: number;
  isLastInTurn?: boolean;
  turnEntries?: LogEntry[];
  isMobile?: boolean;
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
      {isLastInTurn && <TurnCopyButton turnEntries={turnEntries} />}
    </div>
  );
}

export function ErrorBlock({ content, isLastInTurn, turnEntries, isMobile }: { content: string; isLastInTurn?: boolean; turnEntries?: LogEntry[]; isMobile?: boolean }) {
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
      {isLastInTurn && <TurnCopyButton turnEntries={turnEntries} />}
    </div>
  );
}

export function SystemMessage({ content, isMobile }: { content: string; isMobile?: boolean }) {
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
