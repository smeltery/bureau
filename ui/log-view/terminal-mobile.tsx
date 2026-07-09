import { forwardRef, useRef } from "react";

// xterm escape sequences for navigation keys we expose on the soft-key bar.
const ESC = "\x1b";
const TAB = "\t";
const ARROW_UP = "\x1b[A";
const ARROW_DOWN = "\x1b[B";
const ARROW_RIGHT = "\x1b[C";
const ARROW_LEFT = "\x1b[D";
const CTRL_ARROW: Record<string, string> = {
  [ARROW_UP]: "\x1b[1;5A",
  [ARROW_DOWN]: "\x1b[1;5B",
  [ARROW_RIGHT]: "\x1b[1;5C",
  [ARROW_LEFT]: "\x1b[1;5D",
};

// Apply the Ctrl modifier to a single byte of input. Letters and a few
// neighbouring punctuation map onto the C0 control range; for arrow keys we
// rewrite the CSI sequence into its Ctrl-modified form. Everything else
// passes through unchanged.
export function applyCtrl(data: string): string {
  if (data.length === 1) {
    const c = data.charCodeAt(0);
    if (c >= 0x40 && c <= 0x7e) return String.fromCharCode(c & 0x1f);
    return data;
  }
  return CTRL_ARROW[data] ?? data;
}

const MOBILE_TERMINAL_STYLE_ID = "bureau-mobile-terminal-style";
export function ensureMobileTerminalStyle() {
  if (typeof document === "undefined") return;
  if (document.getElementById(MOBILE_TERMINAL_STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = MOBILE_TERMINAL_STYLE_ID;
  // We render our own input proxy textarea on mobile (see MobileInputProxy
  // below) so we own the input pipeline end-to-end — including swipe-typing
  // and IME composition events that xterm's helper textarea historically
  // mishandles. xterm's own helper textarea is hidden so it doesn't compete
  // for focus or buffer composition state out from under us.
  style.textContent = `
.bureau-mobile-term .xterm .xterm-helper-textarea {
  display: none !important;
}
/* touch-action is consulted on the element where the touch starts, not on
   ancestors, so applying it to the body wrapper alone leaves xterm's inner
   canvas/text layers free to fire native pinch-zoom and double-tap-zoom.
   Force pan-y across all descendants of the body wrapper to keep our
   custom pinch-zoom handler in charge. overscroll-behavior: contain stops
   rubber-band scroll from chaining up to the document body on iOS. */
.bureau-mobile-term-body,
.bureau-mobile-term-body * {
  touch-action: pan-y !important;
  overscroll-behavior: contain !important;
}
`;
  document.head.appendChild(style);
}

export type SoftKey = {
  id: string;
  label: string;
  data?: string;
  arrow?: string;
  toggleCtrl?: boolean;
  action?: "paste";
};

// Mobile input proxy: a real (invisible) textarea that owns input on mobile.
// We listen to compositionend (swipe-typing on Android, IME on iOS), input,
// and beforeinput so deletes and line breaks reach the PTY no matter which
// keyboard the user is on. Each delivery clears the textarea so it stays
// empty for the next char. Backspace on an empty textarea doesn't fire
// `input`, so we also fall back to keydown.
//
// TODO (CJK IME): hiding xterm's helper textarea (display:none) means the
// in-place IME composition decoration users see while composing CJK / voice
// dictation isn't rendered. Acceptable for English/swipe; revisit if mobile
// CJK support is requested.
export const MobileInputProxy = forwardRef<HTMLTextAreaElement, { onInput: (data: string) => void }>(function MobileInputProxy({ onInput }, ref) {
  const composingRef = useRef(false);
  // Tracks the most recent beforeinput firing so the keydown fallback can
  // tell whether the same gesture already produced a beforeinput. Without
  // this, a Bluetooth keyboard's Backspace fires keydown AND beforeinput
  // and we'd send DEL twice. (iOS soft keyboards rarely fire keydown, so
  // the issue only shows up on iPad with a hardware keyboard.)
  const lastBeforeInputAtRef = useRef(0);
  function deliver(value: string, target: HTMLTextAreaElement) {
    if (!value) return;
    onInput(value);
    target.value = "";
  }
  return (
    <textarea
      ref={ref}
      autoCapitalize="off"
      autoCorrect="off"
      autoComplete="off"
      spellCheck={false}
      onCompositionStart={() => {
        composingRef.current = true;
      }}
      onCompositionEnd={(e) => {
        composingRef.current = false;
        deliver(e.currentTarget.value, e.currentTarget);
      }}
      onInput={(e) => {
        if (composingRef.current) return;
        deliver(e.currentTarget.value, e.currentTarget);
      }}
      onBeforeInput={(e) => {
        const native = e.nativeEvent as InputEvent;
        // deleteContentBackward fires on Backspace even when value is empty
        // and even when no input event would follow. We translate to DEL
        // (\x7f) which is what readline expects for backspace.
        if (native.inputType === "deleteContentBackward") {
          e.preventDefault();
          lastBeforeInputAtRef.current = Date.now();
          onInput("\x7f");
        } else if (native.inputType === "deleteWordBackward") {
          e.preventDefault();
          lastBeforeInputAtRef.current = Date.now();
          onInput("\x17"); // Ctrl-W
        } else if (native.inputType === "insertLineBreak" || native.inputType === "insertParagraph") {
          e.preventDefault();
          lastBeforeInputAtRef.current = Date.now();
          onInput("\r");
        }
      }}
      onKeyDown={(e) => {
        // Backup for keyboards that don't fire beforeinput cleanly.
        if (composingRef.current) return;
        if (e.key === "Enter") {
          e.preventDefault();
          onInput("\r");
        } else if (e.key === "Tab") {
          e.preventDefault();
          onInput("\t");
        } else if (e.key === "Backspace" && !e.currentTarget.value) {
          // Only intercept the empty case — if there's pending text,
          // beforeinput already handled it. Also skip if beforeinput just
          // fired for this gesture (Bluetooth keyboard fires both).
          if (Date.now() - lastBeforeInputAtRef.current < 100) return;
          e.preventDefault();
          onInput("\x7f");
        }
      }}
      style={{
        position: "absolute",
        left: 0,
        bottom: 0,
        width: "100%",
        height: 24,
        padding: 0,
        border: "none",
        background: "transparent",
        color: "transparent",
        fontSize: 16,
        opacity: 0,
        pointerEvents: "none",
        caretColor: "transparent",
        resize: "none",
        outline: "none",
        zIndex: 1,
      }}
    />
  );
});

// Filled triangles render at consistent widths in iOS's fallback font; the
// thin Unicode arrows (↑↓←→) come out narrower on left/right than up/down.
export const SOFT_KEYS: SoftKey[] = [
  { id: "esc", label: "Esc", data: ESC },
  { id: "tab", label: "Tab", data: TAB },
  { id: "paste", label: "Paste", action: "paste" },
  { id: "ctrl", label: "Ctrl", toggleCtrl: true },
  { id: "up", label: "▲", arrow: ARROW_UP },
  { id: "down", label: "▼", arrow: ARROW_DOWN },
  { id: "left", label: "◀", arrow: ARROW_LEFT },
  { id: "right", label: "▶", arrow: ARROW_RIGHT },
  { id: "pipe", label: "|", data: "|" },
  { id: "tilde", label: "~", data: "~" },
  { id: "slash", label: "/", data: "/" },
  { id: "minus", label: "-", data: "-" },
];

export function MobileSoftKeyBar({ ctrlActive, keyboardOpen, onSoftKey }: { ctrlActive: boolean; keyboardOpen: boolean; onSoftKey: (key: SoftKey) => void }) {
  return (
    <div
      style={{
        display: "flex",
        gap: 6,
        padding: "6px 8px",
        paddingBottom: keyboardOpen ? 6 : "calc(6px + env(safe-area-inset-bottom, 0px))",
        background: "var(--bg-surface)",
        borderTop: "1px solid var(--border-strong)",
        overflowX: "auto",
        WebkitOverflowScrolling: "touch",
        flexShrink: 0,
      }}
    >
      {SOFT_KEYS.map((key) => {
        const isCtrl = key.toggleCtrl;
        const active = isCtrl && ctrlActive;
        return (
          <button
            key={key.id}
            // touchstart + mousedown both preventDefault to keep focus on
            // xterm's helper textarea — Safari's simulated mousedown can
            // arrive too late to block focus shift on touch devices, so
            // we belt-and-braces with touchstart.
            onTouchStart={(e) => e.preventDefault()}
            onMouseDown={(e) => e.preventDefault()}
            onClick={(e) => {
              e.preventDefault();
              onSoftKey(key);
            }}
            style={{
              flexShrink: 0,
              minWidth: 40,
              height: 36,
              padding: "0 12px",
              borderRadius: 6,
              border: `1px solid ${active ? "var(--green-border)" : "var(--border-medium)"}`,
              background: active ? "var(--green-bg)" : "var(--btn-surface)",
              color: active ? "var(--green)" : "var(--text-primary)",
              fontFamily: "'JetBrains Mono', monospace",
              fontSize: 14,
              fontWeight: 500,
              cursor: "pointer",
              userSelect: "none",
              WebkitUserSelect: "none",
              WebkitTapHighlightColor: "transparent",
            }}
          >
            {key.label}
          </button>
        );
      })}
    </div>
  );
}
