import type { QueuedMessage } from "../../shared/types.ts";
import { send } from "../ws.ts";

export function QueueChips({ queue, agentId, isMobile }: { queue: QueuedMessage[]; agentId: string; isMobile?: boolean }) {
  if (queue.length === 0) return null;
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 6,
        padding: isMobile ? "4px 12px 0" : "4px 24px 0",
        // Cap height so the textarea stays reachable when many messages
        // are queued (server caps at 50).
        maxHeight: isMobile ? 200 : 240,
        overflowY: "auto",
      }}
    >
      {queue.map((msg) => {
        const attachmentCount = msg.attachments?.length ?? 0;
        const isAgent = msg.sender.kind === "agent";
        const senderLabel = msg.sender.kind === "agent" ? `${msg.sender.agentName} · agent · Room "${msg.sender.roomName}"` : msg.sender.username || "you";
        return (
          <div
            key={msg.id}
            style={{
              display: "flex",
              alignItems: "flex-start",
              gap: 8,
              padding: "6px 10px",
              borderRadius: 8,
              background: isAgent ? "var(--bg-base)" : "var(--bg-hover)",
              border: `1px ${isAgent ? "dashed" : "solid"} var(--border-medium)`,
              fontSize: isMobile ? 13 : 12,
              fontFamily: "'JetBrains Mono',monospace",
              color: "var(--text-secondary)",
            }}
          >
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 2 }}>
                <span style={{ color: "var(--text-ghost)", fontSize: 10, fontWeight: 600 }}>QUEUED · {senderLabel}</span>
                {attachmentCount > 0 && (
                  <span style={{ fontSize: 10, color: "var(--text-ghost)" }}>
                    · {attachmentCount} attachment{attachmentCount === 1 ? "" : "s"}
                  </span>
                )}
              </div>
              <div style={{ whiteSpace: "pre-wrap", wordBreak: "break-word", color: "var(--text-secondary)" }}>{msg.text}</div>
            </div>
            <button
              onClick={() => send({ type: "dequeue_message", agentId, queuedId: msg.id })}
              style={{
                background: "none",
                border: "none",
                color: "var(--text-muted)",
                cursor: "pointer",
                fontSize: 14,
                padding: 0,
                lineHeight: 1,
                flexShrink: 0,
              }}
              title="Cancel"
            >
              &times;
            </button>
          </div>
        );
      })}
    </div>
  );
}
