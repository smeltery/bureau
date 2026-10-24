import { TeamChatComposer } from "./TeamChatComposer.tsx";
import { useTeamChatRead } from "./useTeamChatRead.ts";
import { TeamChatUnread } from "./TeamChatUnread.tsx";
import { useCallback, useEffect, useRef, useState } from "react";
import { useAppState } from "../store.tsx";
import { addRawListener, removeRawListener } from "../ws.ts";
import { getDevice } from "../device-settings.ts";
import { useI18n } from "../i18n.tsx";
import type { MembersChatMessage, MembersChatReply } from "../../shared/members-chat.ts";
import { membersChatExcerpt } from "../../shared/members-chat.ts";
import { TeamChatMessageCard } from "./TeamChatMessageCard.tsx";

interface PageResponse {
  pinned: MembersChatMessage[];
  messages: MembersChatMessage[];
  hasMore: boolean;
}

export function TeamChatView({ onClose }: { onClose: () => void }) {
  const { t } = useI18n();
  const { sessionContext, isMobile, hydrationEpoch } = useAppState();
  const [messages, setMessages] = useState<MembersChatMessage[]>([]);
  const [pinned, setPinned] = useState<MembersChatMessage[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [draft, setDraft] = useState("");
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const [reply, setReply] = useState<MembersChatReply | null>(null);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | { key: "teamChat.loadFailed" | "teamChat.sendFailed" | "teamChat.deleteFailed" | "teamChat.pinFailed" | "teamChat.replyMissing" } | null>(null);
  const read = useTeamChatRead(messages, loading);
  const revision = useRef(0);
  const loadSequence = useRef(0);
  const isOwner = sessionContext?.role === "owner";
  const myUserId = sessionContext?.userId ?? null;

  const applyPage = useCallback((page: PageResponse, mode: "replace" | "prepend") => {
    setPinned(page.pinned);
    setHasMore(page.hasMore);
    setMessages((prev) => {
      if (mode === "replace") return page.messages;
      const seen = new Set(prev.map((m) => m.id));
      return [...page.messages.filter((m) => !seen.has(m.id)), ...prev];
    });
  }, []);

  const loadPage = useCallback(
    async (before?: string): Promise<void> => {
      const sequence = ++loadSequence.current;
      const startedRevision = revision.current;
      try {
        const qs = new URLSearchParams();
        if (before) qs.set("before", before);
        qs.set("limit", "50");
        const res = await fetch(`/api/members-chat?${qs}`);
        if (sequence !== loadSequence.current) return;
        if (!res.ok) {
          setError({ key: "teamChat.loadFailed" });
          return;
        }
        const page = (await res.json()) as PageResponse;
        if (sequence !== loadSequence.current) return;
        if (startedRevision !== revision.current) return loadPage(before);
        applyPage(page, before ? "prepend" : "replace");
        setError((previous) => (typeof previous === "object" && previous?.key === "teamChat.loadFailed" ? null : previous));
      } catch {
        if (sequence === loadSequence.current) setError({ key: "teamChat.loadFailed" });
      } finally {
        if (sequence === loadSequence.current) setLoading(false);
      }
    },
    [applyPage],
  );

  useEffect(() => {
    void loadPage();
  }, [loadPage, hydrationEpoch]);

  useEffect(() => {
    function onRaw(data: string) {
      let msg: { type?: string; message?: MembersChatMessage; id?: string; updateOnly?: boolean };
      try {
        msg = JSON.parse(data);
      } catch {
        return;
      }
      if (msg.type === "members_chat_message" && msg.message) {
        revision.current++;
        const next = msg.message;
        setPinned((prev) => {
          const without = prev.filter((m) => m.id !== next.id);
          return next.pinnedAt !== undefined ? [next, ...without] : without;
        });
        setMessages((prev) => {
          const idx = prev.findIndex((m) => m.id === next.id);
          if (idx >= 0) {
            const copy = prev.slice();
            copy[idx] = next;
            return copy;
          }
          if (msg.updateOnly) return prev;
          return [...prev, next];
        });
        return;
      }
      if (msg.type === "members_chat_deleted" && typeof msg.id === "string") {
        revision.current++;
        const id = msg.id;
        setMessages((prev) => prev.filter((m) => m.id !== id));
        setPinned((prev) => prev.filter((m) => m.id !== id));
      }
    }
    addRawListener(onRaw);
    return () => removeRawListener(onRaw);
  }, []);

  async function send() {
    const text = draft.trim();
    if (!text || sending) return;
    setSending(true);
    setError(null);
    try {
      const res = await fetch("/api/members-chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, device: getDevice(), ...(reply ? { replyTo: reply.id } : {}) }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string; code?: string } | null;
        setError(body?.code === "reply_not_found" ? { key: "teamChat.replyMissing" } : (body?.error ?? { key: "teamChat.sendFailed" }));
        return;
      }
      const message = (await res.json()) as MembersChatMessage;
      setMessages((prev) => (prev.some((m) => m.id === message.id) ? prev : [...prev, message]));
      setDraft((current) => (current === draft ? "" : current));
      setReply(null);
    } catch {
      setError({ key: "teamChat.sendFailed" });
    } finally {
      setSending(false);
    }
  }

  async function remove(id: string) {
    const res = await fetch(`/api/members-chat/${encodeURIComponent(id)}`, { method: "DELETE" });
    if (!res.ok && res.status !== 204) setError({ key: "teamChat.deleteFailed" });
  }

  async function togglePin(id: string, active: boolean) {
    const res = await fetch(`/api/members-chat/${encodeURIComponent(id)}/pin`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ active }),
    });
    if (!res.ok) setError({ key: "teamChat.pinFailed" });
  }

  return (
    <div
      style={{
        height: isMobile ? "100dvh" : "100vh",
        display: "flex",
        flexDirection: "column",
        background: "var(--bg-base)",
        color: "var(--text-primary)",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 8,
          padding: isMobile ? "0 12px" : "0 20px",
          paddingTop: isMobile ? "env(safe-area-inset-top, 0px)" : undefined,
          minHeight: 44,
          background: "var(--bg-hud)",
          backdropFilter: "blur(16px)",
          borderBottom: "1px solid var(--border-subtle)",
          flexShrink: 0,
          zIndex: 500,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <button onClick={onClose} style={{ background: "none", border: "none", color: "var(--text-muted)", fontSize: 18, cursor: "pointer", padding: "2px 8px" }}>
            ←
          </button>
          <span style={{ fontSize: 15, fontWeight: 700 }}>
            {t("common.teamChat")}
            <TeamChatUnread />
          </span>
        </div>
        <span style={{ fontSize: 11, color: "var(--text-muted)" }}>{t("teamChat.humansOnly")}</span>
      </div>

      {pinned.length > 0 && (
        <div style={{ padding: "8px 16px", borderBottom: "1px solid var(--border-subtle)", background: "var(--bg-surface)", flexShrink: 0 }}>
          <div style={{ fontSize: 10, fontWeight: 600, color: "var(--text-muted)", marginBottom: 6, textTransform: "uppercase", letterSpacing: "0.04em" }}>{t("teamChat.pinned")}</div>
          {pinned.slice(0, 5).map((m) => (
            <div key={m.id} style={{ fontSize: 12, color: "var(--text-dim)", marginBottom: 4 }}>
              <strong style={{ color: "var(--text-primary)" }}>{m.userName}</strong>: {m.content.slice(0, 120)}
            </div>
          ))}
        </div>
      )}

      <div ref={read.viewportRef} onScroll={read.onScroll} data-team-chat-messages style={{ flex: 1, overflowY: "auto", padding: isMobile ? "12px" : "16px 20px" }}>
        {hasMore && (
          <button
            onClick={() => {
              const oldest = messages[0]?.id;
              if (oldest) void loadPage(oldest);
            }}
            style={{
              display: "block",
              margin: "0 auto 12px",
              padding: "6px 12px",
              borderRadius: 6,
              border: "1px solid var(--border)",
              background: "var(--btn-surface)",
              color: "var(--text-dim)",
              fontSize: 11,
              cursor: "pointer",
            }}
          >
            {t("teamChat.loadOlder")}
          </button>
        )}
        {loading ? (
          <div style={{ color: "var(--text-muted)", fontSize: 13 }}>{t("common.loading")}</div>
        ) : messages.length === 0 ? (
          <div style={{ color: "var(--text-muted)", fontSize: 13 }}>{t("teamChat.empty")}</div>
        ) : (
          messages.map((m) => (
            <TeamChatMessageCard
              key={m.id}
              message={m}
              isOwner={!!isOwner}
              myUserId={myUserId}
              onPin={(id, active) => void togglePin(id, active)}
              onDelete={(id) => void remove(id)}
              replyingDisabled={sending}
              onEdited={(edited) => {
                const update = (items: MembersChatMessage[]) =>
                  items.map((item) => (item.id === edited.id && (item.editedAt ?? 0) <= (edited.editedAt ?? 0) ? { ...item, content: edited.content, editedAt: edited.editedAt } : item));
                setMessages(update);
                setPinned(update);
              }}
              onReply={() => {
                setReply({ id: m.id, userName: m.userName, excerpt: membersChatExcerpt(m.content) });
                composerRef.current?.focus({ preventScroll: true });
              }}
              onJump={
                m.replyTo && messages.some((target) => target.id === m.replyTo?.id)
                  ? () => document.getElementById("team-message-" + m.replyTo!.id)?.scrollIntoView({ block: "center", behavior: "smooth" })
                  : undefined
              }
            />
          ))
        )}
      </div>

      {read.failed && (
        <div role="alert" style={{ padding: "6px 16px", color: "var(--red)", fontSize: 12 }}>
          {t("teamChat.readFailed")}{" "}
          <button
            onClick={() => void read.retry()}
            style={{
              marginLeft: 8,
              padding: "4px 10px",
              borderRadius: 6,
              border: "1px solid var(--border)",
              background: "var(--btn-surface)",
              color: "var(--text-primary)",
              fontSize: 12,
              cursor: "pointer",
            }}
          >
            {t("common.retry")}
          </button>
        </div>
      )}
      {error && <div style={{ padding: "6px 16px", color: "var(--red)", fontSize: 12, borderTop: "1px solid var(--border-subtle)" }}>{typeof error === "string" ? error : t(error.key)}</div>}

      <TeamChatComposer
        draft={draft}
        setDraft={setDraft}
        sending={sending}
        isMobile={isMobile}
        composerRef={composerRef}
        reply={reply}
        onCancelReply={() => {
          setReply(null);
          setError((previous) => (typeof previous === "object" && previous?.key === "teamChat.replyMissing" ? null : previous));
        }}
        onSend={() => void send()}
      />
    </div>
  );
}
