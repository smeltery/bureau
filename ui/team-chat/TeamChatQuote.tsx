import type { MembersChatReply } from "../../shared/members-chat.ts";
import { useI18n } from "../i18n.tsx";

export function TeamChatQuote({ reply, onJump }: { reply: MembersChatReply; onJump?: () => void }) {
  const { t } = useI18n();
  const content = (
    <>
      <strong>{t("teamChat.replyingTo", { name: reply.userName })}</strong>
      <div style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere", maxHeight: 80, overflowY: "auto" }}>{reply.excerpt}</div>
    </>
  );
  const style = {
    border: "none",
    borderLeft: "3px solid var(--accent)",
    background: "var(--bg-hud)",
    color: "var(--text-muted)",
    padding: "6px 10px",
    margin: "0 0 6px",
    fontSize: 12,
    textAlign: "left" as const,
    width: "100%",
  };
  return onJump ? (
    <button type="button" onClick={onJump} title={t("teamChat.showOriginal")} style={{ ...style, cursor: "pointer" }}>
      {content}
    </button>
  ) : (
    <blockquote style={style}>{content}</blockquote>
  );
}
