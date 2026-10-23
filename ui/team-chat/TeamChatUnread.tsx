import { useAppState } from "../store.tsx";
import { useI18n } from "../i18n.tsx";

export function TeamChatUnread() {
  const { membersChat } = useAppState();
  const { tn, language } = useI18n();
  const count = membersChat?.unread ?? 0;
  if (!count) return null;
  const label = tn("teamChat.unread", count, { total: count.toLocaleString(language) });
  return (
    <span
      role="img"
      aria-label={label}
      title={label}
      data-team-chat-unread
      style={{ display: "inline-block", marginLeft: 4, padding: "1px 5px", borderRadius: 8, background: "var(--accent)", color: "var(--bg-base)", fontSize: 10, lineHeight: "14px", fontWeight: 700 }}
    >
      {count.toLocaleString(language)}
    </span>
  );
}
