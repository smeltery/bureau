export { MobileInputProxy } from "./terminal/mobile-input.tsx";
export { MobileSoftKeyBar, type SoftKey } from "./terminal/mobile-soft-keys.tsx";
import { ARROW_DOWN, ARROW_LEFT, ARROW_RIGHT, ARROW_UP } from "./terminal/mobile-soft-keys.tsx";

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
