import { useState } from "react";
import type { MembersChatMessage } from "../../shared/members-chat.ts";
import { useI18n } from "../i18n.tsx";

export function TeamChatReaction({ message, myUserId }: { message: MembersChatMessage; myUserId: string | null }) {
  const { t, language } = useI18n();
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const reactions = message.thumbsUp ?? [];
  const active = reactions.some((reactor) => reactor.userId === myUserId);
  async function toggle() {
    if (busy || !myUserId) return;
    setBusy(true);
    setFailed(false);
    try {
      const response = await fetch(`/api/members-chat/${encodeURIComponent(message.id)}/thumbs-up`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ active: !active }),
      });
      if (!response.ok) throw new Error("Reaction update failed");
      // Live events preserve ordering with edits and reactions from other tabs.
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div style={{ marginTop: 8 }}>
      <button
        type="button"
        aria-pressed={active}
        aria-label={t(active ? "teamChat.removeThumbsUp" : "teamChat.addThumbsUp")}
        disabled={busy || !myUserId}
        onClick={() => void toggle()}
        title={reactions.map((reactor) => reactor.userName).join(", ") || t("teamChat.addThumbsUp")}
        style={{
          padding: "4px 8px",
          borderRadius: 12,
          border: active ? "1px solid var(--accent)" : "1px solid var(--border)",
          background: active ? "var(--btn-surface)" : "transparent",
          color: "var(--text-primary)",
          cursor: "pointer",
          fontSize: 12,
        }}
      >
        👍{reactions.length > 0 && <> {new Intl.NumberFormat(language).format(reactions.length)}</>}
      </button>
      {failed && (
        <span role="alert" style={{ marginLeft: 8, fontSize: 12, color: "var(--red)" }}>
          {t("teamChat.reactionFailed")}
        </span>
      )}
    </div>
  );
}
