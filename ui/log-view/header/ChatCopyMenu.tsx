import { useEffect, useRef, useState } from "react";
import { useI18n } from "../../i18n.tsx";
import { copyText } from "../../utils/clipboard.ts";
import { getChatCopyFormat, setChatCopyFormat } from "../../device-settings.ts";
import { CHAT_COPY_SCOPES, type ChatCopyFormat, type ChatCopyScope } from "./chat-copy.ts";

const SCOPE_LABEL = {
  messages: "chat.copy.messages",
  mine: "chat.copy.mine",
  everything: "chat.copy.everything",
  lastExchange: "chat.copy.lastExchange",
} as const;

const COPY_ICON = (
  <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <rect x="5.5" y="5.5" width="8" height="8" rx="1.5" />
    <path d="M10.5 5.5V3.5a1.5 1.5 0 0 0-1.5-1.5H3.5A1.5 1.5 0 0 0 2 3.5V9a1.5 1.5 0 0 0 1.5 1.5h2" />
  </svg>
);

const CHECK_ICON = (
  <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <polyline points="3.5 8.5 6.5 11.5 12.5 4.5" />
  </svg>
);

const rowStyle = {
  display: "block",
  width: "100%",
  textAlign: "left",
  padding: "6px 10px",
  border: "none",
  borderRadius: 6,
  background: "transparent",
  color: "var(--text-primary)",
  fontSize: 12,
  cursor: "pointer",
} as const;

// The chat header's Copy: pick what to copy, in Markdown or plain text. The
// format is remembered per browser.
export function ChatCopyMenu({ getText, size = 24 }: { getText: (scope: ChatCopyScope, format: ChatCopyFormat) => string; size?: number }) {
  const { t } = useI18n();
  const rootRef = useRef<HTMLDivElement>(null);
  // Where the open menu sits, from the button's box: fixed, so the phone
  // header's overflow cannot clip it.
  const [anchor, setAnchor] = useState<{ top: number; right: number } | null>(null);
  const open = anchor !== null;
  const setOpen = (next: boolean) => {
    const box = rootRef.current?.getBoundingClientRect();
    setAnchor(next && box ? { top: box.bottom + 4, right: Math.max(8, window.innerWidth - box.right) } : null);
  };
  const [copied, setCopied] = useState(false);
  const [format, setFormat] = useState<ChatCopyFormat>(getChatCopyFormat);

  useEffect(() => {
    if (!open) return;
    function closeOutside(event: PointerEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    }
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      setOpen(false);
    }
    document.addEventListener("pointerdown", closeOutside);
    window.addEventListener("keydown", closeOnEscape, true);
    return () => {
      document.removeEventListener("pointerdown", closeOutside);
      window.removeEventListener("keydown", closeOnEscape, true);
    };
  }, [open]);

  async function copy(scope: ChatCopyScope) {
    setOpen(false);
    if (!(await copyText(getText(scope, format)))) return;
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  function chooseFormat(next: ChatCopyFormat) {
    setFormat(next);
    setChatCopyFormat(next);
  }

  return (
    <div ref={rootRef} style={{ position: "relative", flexShrink: 0 }}>
      <button
        type="button"
        className="copy-btn"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={t("chat.copy.menu")}
        title={t(copied ? "common.copied" : "chat.copy.menu")}
        onClick={() => setOpen(!open)}
        style={{
          width: size,
          height: size,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          border: "1px solid var(--border-medium)",
          borderRadius: 6,
          background: copied ? "var(--green-bg)" : "var(--btn-surface)",
          color: copied ? "var(--green)" : "var(--text-dim)",
          cursor: "pointer",
          padding: 0,
          transition: "color 0.15s, background 0.15s, border-color 0.15s",
        }}
      >
        {copied ? CHECK_ICON : COPY_ICON}
      </button>
      {anchor && (
        <div
          role="menu"
          aria-label={t("chat.copy.menu")}
          style={{
            position: "fixed",
            top: anchor.top,
            right: anchor.right,
            zIndex: 950,
            minWidth: 180,
            padding: 4,
            background: "var(--bg-overlay-solid)",
            border: "1px solid var(--border-light)",
            borderRadius: 8,
            boxShadow: "0 8px 24px var(--shadow-heavy)",
          }}
        >
          {CHAT_COPY_SCOPES.map((scope) => (
            <button key={scope} type="button" role="menuitem" style={rowStyle} onClick={() => void copy(scope)}>
              {t(SCOPE_LABEL[scope])}
            </button>
          ))}
          <div role="group" aria-label={t("chat.copy.format")} style={{ borderTop: "1px solid var(--border-light)", marginTop: 4, paddingTop: 4 }}>
            {(["markdown", "plain"] as const).map((option) => (
              <button
                key={option}
                type="button"
                role="menuitemradio"
                aria-checked={format === option}
                style={{ ...rowStyle, color: format === option ? "var(--text-primary)" : "var(--text-dim)" }}
                onClick={() => chooseFormat(option)}
              >
                {format === option ? "● " : "○ "}
                {t(option === "markdown" ? "chat.copy.markdown" : "chat.copy.plain")}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
