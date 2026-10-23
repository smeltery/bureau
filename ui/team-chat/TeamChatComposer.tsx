import type { RefObject } from "react";
import { MEMBERS_CHAT_MAX_CHARS, type MembersChatReply } from "../../shared/members-chat.ts";
import { composerHeightLimit, useComposerResize } from "../hooks/useComposerResize.ts";
import { useI18n } from "../i18n.tsx";
import { TeamChatQuote } from "./TeamChatQuote.tsx";

export function TeamChatComposer({
  draft,
  setDraft,
  sending,
  isMobile,
  composerRef,
  reply,
  onCancelReply,
  onSend,
}: {
  draft: string;
  setDraft: (value: string) => void;
  sending: boolean;
  isMobile: boolean;
  composerRef: RefObject<HTMLTextAreaElement | null>;
  reply: MembersChatReply | null;
  onCancelReply: () => void;
  onSend: () => void;
}) {
  const { t } = useI18n();
  useComposerResize(composerRef, draft, isMobile, 18);
  return (
    <>
      {reply && (
        <div data-team-chat-reply style={{ padding: "8px 16px", flexShrink: 0 }}>
          <TeamChatQuote reply={reply} />
          <button type="button" disabled={sending} onClick={onCancelReply} style={{ border: "none", background: "none", color: "var(--text-muted)", cursor: "pointer", padding: "6px 0" }}>
            {t("teamChat.cancelReply")}
          </button>
        </div>
      )}
      <div
        style={{
          display: "flex",
          gap: 8,
          padding: isMobile ? "10px 12px calc(10px + env(safe-area-inset-bottom, 0px))" : "12px 20px",
          borderTop: "1px solid var(--border-subtle)",
          background: "var(--bg-hud)",
          flexShrink: 0,
        }}
      >
        <textarea
          ref={composerRef}
          value={draft}
          onChange={(e) => setDraft(e.target.value.slice(0, MEMBERS_CHAT_MAX_CHARS))}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !e.ctrlKey && !e.metaKey && !isMobile && !e.nativeEvent.isComposing) {
              e.preventDefault();
              onSend();
            }
          }}
          placeholder={t("teamChat.placeholder")}
          rows={2}
          style={{
            flex: 1,
            resize: "none",
            borderRadius: 8,
            border: "1px solid var(--border)",
            background: "var(--bg-surface)",
            color: "var(--text-primary)",
            padding: "8px 10px",
            fontSize: isMobile ? 16 : 13,
            lineHeight: "20px",
            maxHeight: composerHeightLimit(isMobile, 18),
            overflowY: "auto",
            fontFamily: "inherit",
          }}
        />
        <button
          onClick={onSend}
          disabled={sending || !draft.trim()}
          style={{
            padding: "0 16px",
            borderRadius: 8,
            border: "none",
            background: draft.trim() ? "var(--accent)" : "var(--btn-surface)",
            color: draft.trim() ? "var(--bg-base)" : "var(--text-muted)",
            fontWeight: 600,
            fontSize: 13,
            cursor: draft.trim() ? "pointer" : "default",
          }}
        >
          {t("teamChat.post")}
        </button>
      </div>
    </>
  );
}
