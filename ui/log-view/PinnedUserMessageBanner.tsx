import type { LogEntry } from "../../shared/types.ts";

export function PinnedUserMessageBanner({ pinnedMessage, isMobile, onClick }: { pinnedMessage: LogEntry; isMobile: boolean; onClick: () => void }) {
  return (
    <div
      onClick={onClick}
      title={pinnedMessage.content}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        padding: isMobile ? "6px 12px" : "6px 24px",
        background: "var(--bg-subtle)",
        borderBottom: "1px solid var(--border)",
        cursor: "pointer",
        color: "var(--text-muted)",
        fontSize: 12,
        flexShrink: 0,
      }}
    >
      <span style={{ color: "var(--text-ghost)", flexShrink: 0, fontWeight: 600 }}>↑ you:</span>
      <span
        style={{
          flex: 1,
          whiteSpace: "nowrap",
          overflow: "hidden",
          textOverflow: "ellipsis",
          minWidth: 0,
        }}
      >
        {pinnedMessage.content}
      </span>
      <span style={{ color: "var(--text-ghost)", flexShrink: 0, fontSize: 11, lineHeight: 1 }}>↑</span>
    </div>
  );
}
