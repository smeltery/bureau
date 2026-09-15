import { useCallback, useEffect, useRef, useState } from "react";
import { useAppState } from "../store.tsx";
import { addRawListener, removeRawListener } from "../ws.ts";
import { getDevice } from "../device-settings.ts";
import { useI18n } from "../i18n.tsx";
import type { MembersChatMessage } from "../../shared/members-chat.ts";
import { MEMBERS_CHAT_MAX_CHARS } from "../../shared/members-chat.ts";
import { TeamChatMessageCard } from "./TeamChatMessageCard.tsx";

interface PageResponse {
  pinned: MembersChatMessage[];
  messages: MembersChatMessage[];
  hasMore: boolean;
}

export function TeamChatView({ onClose }: { onClose: () => void }) {
  const { t } = useI18n();
  const { sessionContext, isMobile } = useAppState();
  const [messages, setMessages] = useState<MembersChatMessage[]>([]);
  const [pinned, setPinned] = useState<MembersChatMessage[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [draft, setDraft] = useState("");
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);
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
    async (before?: string) => {
      const qs = new URLSearchParams();
      if (before) qs.set("before", before);
      qs.set("limit", "50");
      const res = await fetch(`/api/members-chat?${qs}`);
      if (!res.ok) {
        setError(t("teamChat.loadFailed"));
        return;
      }
      applyPage((await res.json()) as PageResponse, before ? "prepend" : "replace");
      setLoading(false);
    },
    [applyPage, t],
  );

  useEffect(() => {
    void loadPage();
  }, [loadPage]);

  useEffect(() => {
    function onRaw(data: string) {
      let msg: { type?: string; message?: MembersChatMessage; id?: string; updateOnly?: boolean };
      try {
        msg = JSON.parse(data);
      } catch {
        return;
      }
      if (msg.type === "members_chat_message" && msg.message) {
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
        const id = msg.id;
        setMessages((prev) => prev.filter((m) => m.id !== id));
        setPinned((prev) => prev.filter((m) => m.id !== id));
      }
    }
    addRawListener(onRaw);
    return () => removeRawListener(onRaw);
  }, []);

  useEffect(() => {
    if (loading) return;
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length, loading]);

  async function send() {
    const text = draft.trim();
    if (!text || sending) return;
    setSending(true);
    setError(null);
    try {
      const res = await fetch("/api/members-chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, device: getDevice() }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        setError(body?.error ?? t("teamChat.sendFailed"));
        return;
      }
      setDraft("");
      const message = (await res.json()) as MembersChatMessage;
      setMessages((prev) => (prev.some((m) => m.id === message.id) ? prev : [...prev, message]));
    } finally {
      setSending(false);
    }
  }

  async function remove(id: string) {
    const res = await fetch(`/api/members-chat/${encodeURIComponent(id)}`, { method: "DELETE" });
    if (!res.ok && res.status !== 204) setError(t("teamChat.deleteFailed"));
  }

  async function togglePin(id: string, active: boolean) {
    const res = await fetch(`/api/members-chat/${encodeURIComponent(id)}/pin`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ active }),
    });
    if (!res.ok) setError(t("teamChat.pinFailed"));
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
          <span style={{ fontSize: 15, fontWeight: 700 }}>{t("common.teamChat")}</span>
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

      <div style={{ flex: 1, overflowY: "auto", padding: isMobile ? "12px" : "16px 20px" }}>
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
            <TeamChatMessageCard key={m.id} message={m} isOwner={!!isOwner} myUserId={myUserId} onPin={(id, active) => void togglePin(id, active)} onDelete={(id) => void remove(id)} />
          ))
        )}
        <div ref={bottomRef} />
      </div>

      {error && <div style={{ padding: "6px 16px", color: "var(--red)", fontSize: 12, borderTop: "1px solid var(--border-subtle)" }}>{error}</div>}

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
          value={draft}
          onChange={(e) => setDraft(e.target.value.slice(0, MEMBERS_CHAT_MAX_CHARS))}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void send();
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
            fontSize: 13,
            fontFamily: "inherit",
          }}
        />
        <button
          onClick={() => void send()}
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
    </div>
  );
}
