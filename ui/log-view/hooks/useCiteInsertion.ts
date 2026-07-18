import { useCallback, type RefObject } from "react";

export function useCiteInsertion({
  inputRef,
  textareaRef,
  setInput,
  clearCite,
  autoResize,
}: {
  inputRef: RefObject<string>;
  textareaRef: RefObject<HTMLTextAreaElement | null>;
  setInput: (text: string) => void;
  clearCite: () => void;
  autoResize: (el: HTMLTextAreaElement) => void;
}) {
  return useCallback(
    (text: string, title = "Cited text") => {
      const ta = textareaRef.current;
      const current = inputRef.current;
      const block = `${title}:\n"""\n${text}\n"""\n`;

      let newDraft: string;
      let caretPos: number;

      if (ta && document.activeElement === ta) {
        const start = ta.selectionStart ?? current.length;
        const end = ta.selectionEnd ?? current.length;
        const before = current.slice(0, start);
        const after = current.slice(end);
        const leadSep = before === "" || before.endsWith("\n") ? "" : "\n";
        const trailSep = after === "" || after.startsWith("\n") ? "" : "\n";
        const insertion = leadSep + block + trailSep;
        newDraft = before + insertion + after;
        caretPos = before.length + insertion.length;
      } else {
        if (current === "") {
          newDraft = block;
        } else {
          const sep = current.endsWith("\n\n") ? "" : current.endsWith("\n") ? "\n" : "\n\n";
          newDraft = current + sep + block;
        }
        caretPos = newDraft.length;
      }

      setInput(newDraft);
      clearCite();
      window.getSelection()?.removeAllRanges();
      requestAnimationFrame(() => {
        const ta2 = textareaRef.current;
        if (!ta2) return;
        ta2.focus({ preventScroll: true });
        ta2.setSelectionRange(caretPos, caretPos);
        autoResize(ta2);
      });
    },
    [inputRef, textareaRef, setInput, clearCite, autoResize],
  );
}
