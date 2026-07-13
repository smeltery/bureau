import { useCallback, useEffect, useRef } from "react";
import type { Action } from "../../store.tsx";

export function useLogViewInput(agentId: string, input: string, dispatch: React.Dispatch<Action>) {
  const inputRef = useRef(input);
  inputRef.current = input;
  const setInput = useCallback((text: string) => dispatch({ type: "set_draft", agentId, text }), [dispatch, agentId]);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const autoResize = useCallback((el: HTMLTextAreaElement) => {
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 200) + "px";
  }, []);

  // Auto-resize textarea and place cursor at end when draft is restored.
  useEffect(() => {
    if (textareaRef.current && input) {
      autoResize(textareaRef.current);
      const len = textareaRef.current.value.length;
      textareaRef.current.setSelectionRange(len, len);
    }
  }, []);

  return { inputRef, setInput, textareaRef, autoResize };
}
