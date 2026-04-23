import { useState } from "react";
import type { LogEntry } from "../../../shared/types.ts";
import { AttachmentDisplay, DurationLabel, TurnCopyButton } from "./shared.tsx";

function extractToolSummary(toolName: string, input: unknown): string {
  if (!input || typeof input !== "object") return "";
  const obj = input as Record<string, unknown>;
  switch (toolName) {
    case "Bash":
      return typeof obj.command === "string" ? obj.command.slice(0, 80) : "";
    case "Read":
      return typeof obj.file_path === "string" ? obj.file_path : "";
    case "Write":
    case "Edit":
      return typeof obj.file_path === "string" ? obj.file_path : "";
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

export function ToolCall({ name, input, durationMs, isLastInTurn, turnEntries, isMobile }: { name: string; input: unknown; durationMs?: number; isLastInTurn?: boolean; turnEntries?: LogEntry[]; isMobile?: boolean }) {
  const [open, setOpen] = useState(false);
  const inputStr = typeof input === "string" ? input : JSON.stringify(input, null, 2);
  const summary = extractToolSummary(name, input);

  return (
    <div style={{ margin: "4px 0", position: "relative" }}>
      <button
        onClick={() => setOpen(!open)}
        style={{
          display: "flex", alignItems: "center", gap: 6,
          padding: "5px 10px", paddingRight: isLastInTurn ? 40 : 10,
          border: "1px solid var(--green-border)",
          borderRadius: 6, background: "var(--tool-call-bg)",
          color: "var(--green)", fontSize: isMobile ? 14 : 12, cursor: "pointer",
          fontFamily: "'JetBrains Mono',monospace", width: "100%", textAlign: "left",
        }}
      >
        <span style={{ transform: open ? "rotate(90deg)" : "rotate(0deg)", transition: "transform 0.15s", display: "inline-block", fontSize: 8 }}>&#9654;</span>
        <span style={{ fontWeight: 600 }}>{name}</span>
        {summary && <span style={{ color: "var(--text-faint)", marginLeft: 4, fontSize: isMobile ? 13 : 11, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1 }}>{summary}</span>}
        {durationMs != null && <DurationLabel ms={durationMs} isMobile={isMobile} />}
      </button>
      {open && (
        <div style={{
          margin: "2px 0 2px 20px", padding: "8px 10px",
          borderRadius: 6, background: "var(--tool-open-bg)",
          fontSize: isMobile ? 13 : 11, fontFamily: "'JetBrains Mono',monospace",
          color: "var(--text-dim)", lineHeight: 1.5, whiteSpace: "pre-wrap",
          maxHeight: 200, overflowY: "auto", overflowX: "auto", maxWidth: "100%",
        }}>
          {inputStr}
        </div>
      )}
      {isLastInTurn && <TurnCopyButton turnEntries={turnEntries} />}
    </div>
  );
}

export function ToolResult({ entry, isLastInTurn, turnEntries, isMobile }: { entry: LogEntry; isLastInTurn?: boolean; turnEntries?: LogEntry[]; isMobile?: boolean }) {
  const [open, setOpen] = useState(false);
  const [lightboxSrc, setLightboxSrc] = useState<string | null>(null);
  const content = entry.content;
  const isLong = content.length > 200;
  const preview = isLong ? content.slice(0, 150) + "..." : content;

  return (
    <div style={{
      margin: "2px 0 8px 20px", padding: "6px 10px",
      borderRadius: 6, background: "var(--tool-result-bg)",
      borderLeft: "2px solid var(--green-border)",
      fontSize: isMobile ? 13 : 11, fontFamily: "'JetBrains Mono',monospace",
      color: "var(--text-dim)", lineHeight: 1.5, position: "relative",
    }}>
      {content && <div style={{ whiteSpace: "pre-wrap", overflowX: "auto", maxWidth: "100%" }}>{open ? content : preview}</div>}
      {isLong && (
        <button
          onClick={() => setOpen(!open)}
          style={{
            marginTop: 4, padding: "2px 6px", border: "none",
            background: "var(--expand-btn)", borderRadius: 4,
            color: "var(--text-faint)", fontSize: isMobile ? 12 : 10, cursor: "pointer",
          }}
        >
          {open ? "Show less" : "Show more"}
        </button>
      )}
      {entry.attachments && entry.attachments.length > 0 && (
        <AttachmentDisplay
          attachments={entry.attachments}
          agentId={entry.agentId}
          isMobile={isMobile}
          lightboxSrc={lightboxSrc}
          setLightboxSrc={setLightboxSrc}
          hasContent={!!content}
        />
      )}
      {isLastInTurn && <TurnCopyButton turnEntries={turnEntries} />}
    </div>
  );
}
