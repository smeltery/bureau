import type { MembersChatMessage } from "../../shared/members-chat.ts";
import { useI18n } from "../i18n.tsx";

function formatTime(ts: number): string {
  try {
    return new Date(ts).toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return "";
  }
}

export function TeamChatMessageCard({
  message,
  isOwner,
  myUserId,
  onPin,
  onDelete,
}: {
  message: MembersChatMessage;
  isOwner: boolean;
  myUserId: string | null;
  onPin: (id: string, active: boolean) => void;
  onDelete: (id: string) => void;
}) {
  const { t } = useI18n();
  const canDelete = isOwner || message.userId === myUserId;
  return (
    <div
      style={{
        marginBottom: 14,
        padding: "10px 12px",
        borderRadius: 8,
        border: "1px solid var(--border-subtle)",
        background: "var(--bg-surface)",
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", gap: 8, marginBottom: 4 }}>
        <div style={{ fontSize: 12, fontWeight: 600 }}>
          {message.userName}
          {message.device ? <span style={{ fontWeight: 400, color: "var(--text-muted)" }}> · {message.device}</span> : null}
          {message.pinnedAt !== undefined ? <span style={{ marginLeft: 6, color: "var(--accent)", fontSize: 10, fontWeight: 600 }}>{t("teamChat.pinnedBadge")}</span> : null}
        </div>
        <div style={{ fontSize: 10, color: "var(--text-ghost)" }}>{formatTime(message.timestamp)}</div>
      </div>
      <div style={{ fontSize: 13, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>{message.content}</div>
      {(canDelete || isOwner) && (
        <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
          {isOwner && (
            <button
              onClick={() => onPin(message.id, message.pinnedAt === undefined)}
              style={{ background: "none", border: "none", color: "var(--text-muted)", fontSize: 11, cursor: "pointer", padding: 0 }}
            >
              {message.pinnedAt === undefined ? t("teamChat.pin") : t("teamChat.unpin")}
            </button>
          )}
          {canDelete && (
            <button onClick={() => onDelete(message.id)} style={{ background: "none", border: "none", color: "var(--text-muted)", fontSize: 11, cursor: "pointer", padding: 0 }}>
              {t("common.delete")}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
