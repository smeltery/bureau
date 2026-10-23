import { useI18n } from "../i18n.tsx";
import type { QueuedMessage } from "../../shared/types.ts";
import { send } from "../ws.ts";

export function QueueChips({ queue, agentId, isMobile }: { queue: QueuedMessage[]; agentId: string; isMobile?: boolean }) {
  const { t, tn, language } = useI18n();
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
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
        <span
          style={{
            fontSize: isMobile ? 11 : 10,
            fontWeight: 600,
            color: "var(--text-muted)",
            textTransform: "uppercase",
          }}
        >
          {tn("chat.queue.count", queue.length, { total: queue.length.toLocaleString(language) })}
        </span>
        <button
          onClick={() => send({ type: "send_now", agentId })}
          style={{
            padding: "2px 10px",
            borderRadius: 4,
            border: "1px solid var(--green)",
            background: "var(--green)",
            color: "var(--bg-base)",
            fontSize: 11,
            fontWeight: 600,
            cursor: "pointer",
            flexShrink: 0,
          }}
          title={t("chat.queue.flush")}
        >
          {t("chat.queue.sendNow")}
        </button>
      </div>
      {queue.map((msg) => {
        const attachmentCount = msg.attachments?.length ?? 0;
        const isProgrammatic = msg.sender.kind === "webhook" || msg.sender.kind === "agent" || msg.sender.kind === "app" || msg.sender.kind === "cronjob";
        const senderLabel =
          msg.sender.kind === "webhook"
            ? t("chat.queue.webhook", { name: msg.sender.webhookName })
            : msg.sender.kind === "agent"
              ? t("chat.sender.agent", { name: msg.sender.agentName, room: msg.sender.roomName })
              : msg.sender.kind === "app"
                ? t("chat.sender.app", { name: msg.sender.appName })
                : msg.sender.kind === "cronjob"
                  ? t("chat.sender.cronjob", { name: msg.sender.cronjobName })
                  : msg.sender.username || t("chat.sender.you");
        return (
          <div
            key={msg.id}
            style={{
              display: "flex",
              alignItems: "flex-start",
              gap: 8,
              padding: "6px 10px",
              borderRadius: 8,
              background: isProgrammatic ? "var(--bg-base)" : "var(--bg-hover)",
              border: `1px ${isProgrammatic ? "dashed" : "solid"} var(--border-medium)`,
              fontSize: isMobile ? 13 : 12,
              fontFamily: "'JetBrains Mono',monospace",
              color: "var(--text-secondary)",
            }}
          >
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap", marginBottom: 2 }}>
                <span style={{ color: "var(--text-ghost)", fontSize: 10, fontWeight: 600 }}>{t("chat.queue.sender", { sender: senderLabel })}</span>
                {attachmentCount > 0 && (
                  <span style={{ fontSize: 10, color: "var(--text-ghost)" }}>· {tn("chat.attachments", attachmentCount, { total: attachmentCount.toLocaleString(language) })}</span>
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
              aria-label={t("common.cancel")}
              title={t("common.cancel")}
            >
              &times;
            </button>
          </div>
        );
      })}
    </div>
  );
}
