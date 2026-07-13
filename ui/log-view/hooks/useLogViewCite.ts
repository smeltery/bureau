import { useCallback, useMemo, type RefObject } from "react";
import { useSelectionCite } from "../useSelectionCite.ts";
import { useCiteInsertion } from "./useCiteInsertion.ts";

type UseLogViewCiteOptions = {
  autoResize: (element: HTMLTextAreaElement) => void;
  editingLogEntryId: string | null;
  inputRef: RefObject<string>;
  recomputePinned: () => void;
  scrollRef: RefObject<HTMLDivElement | null>;
  textareaRef: RefObject<HTMLTextAreaElement | null>;
  handleAutoScroll: () => void;
  setInput: (text: string) => void;
};

export function useLogViewCite({ autoResize, editingLogEntryId, inputRef, recomputePinned, scrollRef, textareaRef, handleAutoScroll, setInput }: UseLogViewCiteOptions) {
  const isTouchPrimary = useMemo(() => typeof window !== "undefined" && !!window.matchMedia?.("(pointer: coarse)").matches, []);
  const citeEnabled = !isTouchPrimary && !editingLogEntryId;
  const { cite, clearCite } = useSelectionCite(scrollRef, citeEnabled);

  const handleScroll = useCallback(() => {
    handleAutoScroll();
    recomputePinned();
    if (cite) clearCite();
  }, [handleAutoScroll, recomputePinned, cite, clearCite]);

  const handleCite = useCiteInsertion({
    inputRef,
    textareaRef,
    setInput,
    clearCite,
    autoResize,
  });

  return { cite, handleCite, handleScroll };
}
