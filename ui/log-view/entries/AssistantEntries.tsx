import { useCallback, useState } from "react";
import type { LogEntry } from "../../../shared/types.ts";
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

export function ThinkingBlock({ content, durationMs, isLastInTurn, turnEntries, isMobile }: { content: string; durationMs?: number; isLastInTurn?: boolean; turnEntries?: LogEntry[]; isMobile?: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <div style={{ margin: "4px 0", position: "relative" }}>
      <button
        onClick={() => setOpen(!open)}
        style={{
          display: "flex", alignItems: "center", gap: 6,
          padding: "4px 8px", border: "none", background: "transparent",
          color: "var(--text-faint)", fontSize: isMobile ? 13 : 11, cursor: "pointer",
          width: "100%", textAlign: "left",
        }}
      >
        <span style={{ transform: open ? "rotate(90deg)" : "rotate(0deg)", transition: "transform 0.15s", display: "inline-block" }}>&#9654;</span>
        Thinking...
        {durationMs != null && <DurationLabel ms={durationMs} isMobile={isMobile} />}
      </button>
      {open && (
        <div style={{
          margin: "4px 0 4px 20px", padding: "8px 12px",
          borderRadius: 8, background: "var(--thinking-bg)",
          borderLeft: "2px solid var(--thinking-border)",
          color: "var(--text-faint)", fontSize: isMobile ? 14 : 12, fontFamily: "'JetBrains Mono',monospace",
          lineHeight: 1.6, whiteSpace: "pre-wrap", maxHeight: 300, overflowY: "auto", overflowWrap: "break-word", wordBreak: "break-word",
        }}>
          {content}
        </div>
      )}
      {isLastInTurn && <TurnCopyButton turnEntries={turnEntries} />}
    </div>
  );
}

export function ErrorBlock({ content, isLastInTurn, turnEntries, isMobile }: { content: string; isLastInTurn?: boolean; turnEntries?: LogEntry[]; isMobile?: boolean }) {
  return (
    <div style={{
      margin: "8px 0", padding: "10px 14px",
      borderRadius: 8, background: "var(--red-bg)",
      borderLeft: "3px solid var(--red)",
      color: "var(--red)", fontSize: isMobile ? 14 : 12, fontFamily: "'JetBrains Mono',monospace",
      lineHeight: 1.5, whiteSpace: "pre-wrap", overflowWrap: "break-word", wordBreak: "break-word", position: "relative",
    }}>
      {content}
      {isLastInTurn && <TurnCopyButton turnEntries={turnEntries} />}
    </div>
  );
}

export function SystemMessage({ content, isMobile }: { content: string; isMobile?: boolean }) {
  const isMultiline = content.includes("\n");
  return (
    <div style={{
      margin: "8px 0", padding: "6px 0",
      textAlign: isMultiline ? "left" : "center",
      color: isMultiline ? "var(--text-dim)" : "var(--text-ghost)",
      fontSize: isMultiline ? (isMobile ? 15 : 13) : (isMobile ? 13 : 11),
      fontFamily: isMultiline ? "'JetBrains Mono',monospace" : undefined,
      fontStyle: isMultiline ? "normal" : "italic",
      ...(!isMultiline && { whiteSpace: "pre-wrap" }),
    }}>
      {isMultiline ? <Markdown content={content} /> : content}
    </div>
  );
}
