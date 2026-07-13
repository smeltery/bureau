export type SoftKey = {
  id: string;
  label: string;
  data?: string;
  arrow?: string;
  toggleCtrl?: boolean;
  action?: "paste";
};

// xterm escape sequences for navigation keys we expose on the soft-key bar.
export const ESC = "\x1b";
export const TAB = "\t";
export const ARROW_UP = "\x1b[A";
export const ARROW_DOWN = "\x1b[B";
export const ARROW_RIGHT = "\x1b[C";
export const ARROW_LEFT = "\x1b[D";

// Filled triangles render at consistent widths in iOS's fallback font; the
// thin Unicode arrows (↑↓←→) come out narrower on left/right than up/down.
const SOFT_KEYS: SoftKey[] = [
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
