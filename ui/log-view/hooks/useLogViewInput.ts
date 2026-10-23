import { useComposerResize } from "../../hooks/useComposerResize.ts";
import { useCallback, useEffect, useRef } from "react";
import type { Action } from "../../store.tsx";

export function useLogViewInput(agentId: string, input: string, dispatch: React.Dispatch<Action>, isMobile: boolean) {
  const inputRef = useRef(input);
  inputRef.current = input;
  const setInput = useCallback((text: string) => dispatch({ type: "set_draft", agentId, text }), [dispatch, agentId]);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const autoResize = useComposerResize(textareaRef, input, isMobile);

  // Auto-resize textarea and place cursor at end when draft is restored.
  useEffect(() => {
    if (textareaRef.current && input) {
      const len = textareaRef.current.value.length;
      textareaRef.current.setSelectionRange(len, len);
    }
  }, []);

  return { inputRef, setInput, textareaRef, autoResize };
}
