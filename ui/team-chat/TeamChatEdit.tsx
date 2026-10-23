import { useRef, useState } from "react";
import { MEMBERS_CHAT_MAX_CHARS, type MembersChatMessage } from "../../shared/members-chat.ts";
import { useComposerResize, composerHeightLimit } from "../hooks/useComposerResize.ts";
import { useI18n } from "../i18n.tsx";
import { useAppState } from "../store.tsx";

export function TeamChatEdit({ message, onClose, onSaved }: { message: MembersChatMessage; onClose: () => void; onSaved: (message: MembersChatMessage) => void }) {
  const { t } = useI18n();
  const { isMobile } = useAppState();
  const [text, setText] = useState(message.content);
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState(false);
  const ref = useRef<HTMLTextAreaElement>(null);
  useComposerResize(ref, text, isMobile, 18);
  async function save() {
    if (saving || !text.trim()) return;
    setSaving(true);
    setFailed(false);
    try {
      const response = await fetch("/api/members-chat/" + encodeURIComponent(message.id), { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text }) });
      if (!response.ok) throw new Error("Message update failed");
      onSaved((await response.json()) as MembersChatMessage);
      onClose();
    } catch {
      setFailed(true);
    } finally {
      setSaving(false);
    }
  }
  const buttonStyle = { border: "1px solid var(--border)", borderRadius: 6, padding: "6px 12px", background: "var(--btn-surface)", color: "var(--text-primary)", cursor: "pointer" };
  return (
    <div>
      <textarea
        ref={ref}
        aria-label={t("teamChat.editMessage")}
        value={text}
        disabled={saving}
        autoFocus
        rows={2}
        maxLength={MEMBERS_CHAT_MAX_CHARS}
        onChange={(event) => setText(event.target.value)}
        onKeyDown={(event) => {
          if (event.nativeEvent.isComposing) return;
          if (event.key === "Escape" && !saving) {
            event.preventDefault();
            event.stopPropagation();
            onClose();
          }
          if (event.key === "Enter" && !event.shiftKey && !event.ctrlKey && !event.metaKey && !isMobile) {
            event.preventDefault();
            void save();
          }
        }}
        style={{
          width: "100%",
          resize: "none",
          padding: "8px",
          border: "1px solid var(--border)",
          borderRadius: 6,
          background: "var(--bg-input)",
          color: "var(--text-primary)",
          fontFamily: "inherit",
          fontSize: isMobile ? 16 : 13,
          lineHeight: "20px",
          maxHeight: composerHeightLimit(isMobile, 18),
        }}
      />
      {failed && (
        <div role="alert" style={{ color: "var(--red)", fontSize: 12, padding: "6px 0" }}>
          {t("teamChat.editFailed")}
        </div>
      )}
      <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
        <button type="button" style={buttonStyle} disabled={saving || !text.trim()} onClick={() => void save()}>
          {t("common.save")}
        </button>
        <button type="button" style={buttonStyle} disabled={saving} onClick={onClose}>
          {t("common.cancel")}
        </button>
      </div>
    </div>
  );
}
