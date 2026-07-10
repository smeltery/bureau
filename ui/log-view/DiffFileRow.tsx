import type { DiffFileSummary } from "../../shared/types.ts";
import { DiffRenderer, type DiffOutputFormat } from "./DiffRenderer.tsx";
import { FilePath, PlusMinus, StatusBadge } from "./DiffFileBits.tsx";

export function DiffFileRow({
  summary,
  patch,
  outputFormat,
  expanded,
  onToggle,
  onOverlay,
  truncated,
}: {
  summary: DiffFileSummary;
  patch: string | null;
  outputFormat: DiffOutputFormat;
  expanded: boolean;
  onToggle: () => void;
  onOverlay: () => void;
  truncated: boolean;
}) {
  const handleClick = summary.inlineEligible ? onToggle : onOverlay;
  const overlayHint = !summary.inlineEligible
    ? truncated
      ? "Open (patch not shipped)"
      : summary.status === "binary"
        ? "Open (binary)"
        : summary.status === "untracked"
          ? "Open (untracked, too large)"
          : `Open (${summary.lineCount} lines)`
    : null;

  return (
    <div style={{ borderTop: "1px solid var(--border-subtle)" }}>
      <button
        onClick={handleClick}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          width: "100%",
          padding: "8px 12px",
          border: "none",
          background: "transparent",
          color: "var(--text-secondary)",
          textAlign: "left",
          cursor: "pointer",
          fontFamily: "'JetBrains Mono',monospace",
          fontSize: 12,
        }}
        onMouseEnter={(e) => (e.currentTarget.style.background = "var(--bg-hover)")}
        onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
      >
        {summary.inlineEligible ? (
          <span
            style={{
              transform: expanded ? "rotate(90deg)" : "rotate(0deg)",
              transition: "transform 0.15s",
              display: "inline-block",
              fontSize: 8,
              color: "var(--text-faint)",
              flexShrink: 0,
            }}
          >
            &#9654;
          </span>
        ) : (
          <span style={{ width: 8, color: "var(--text-faint)", fontSize: 12, flexShrink: 0 }}>&#x29C9;</span>
        )}
        <StatusBadge status={summary.status} />
        <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          <FilePath summary={summary} />
        </span>
        <PlusMinus additions={summary.additions} deletions={summary.deletions} />
        {overlayHint && <span style={{ color: "var(--text-faint)", fontSize: 10, flexShrink: 0 }}>{overlayHint}</span>}
      </button>
      {summary.inlineEligible && expanded && patch && (
        <div style={{ padding: "0 12px 10px 28px", overflowX: "auto" }}>
          <DiffRenderer patchText={patch} outputFormat={outputFormat} />
        </div>
      )}
    </div>
  );
}
