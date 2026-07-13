import { forwardRef, useRef } from "react";

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
