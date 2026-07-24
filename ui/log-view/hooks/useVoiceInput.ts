import { useEffect, useRef, useState } from "react";

/**
 * Speech-recognition input.
 *
 * Dictation appends to whatever's already in the draft. Ctrl+Space is the
 * global hold-to-talk shortcut; the mic button toggles dictation.
 *
 * `onTranscript` receives every result update (interim or final) and the
 * caller should reflect it in its draft state. `onGrow` fires after the
 * draft changes so the textarea can `autoResize`.
 *
 * Speech recognition only works over HTTPS; `speechAvailable` reflects both
 * `SpeechRecognition` API presence and `window.isSecureContext`. Over HTTP
 * the mic button should still appear disabled so the user can be told why
 * (via `showMicHint`).
 */
export function useVoiceInput({ inputRef, onTranscript, onGrow }: { inputRef: React.MutableRefObject<string>; onTranscript: (text: string) => void; onGrow: () => void }) {
  const SpeechRecognition = (typeof window !== "undefined" && ((window as any).SpeechRecognition || (window as any).webkitSpeechRecognition)) || null;
  const isSecureContext = typeof window !== "undefined" && window.isSecureContext;
  const speechApiPresent = !!SpeechRecognition;
  const speechAvailable = speechApiPresent && isSecureContext;

  const [isListening, setIsListening] = useState(false);
  const isListeningRef = useRef(false);
  const [showMicHint, setShowMicHint] = useState(false);
  const recognitionRef = useRef<SpeechRecognition | null>(null);
  // Tracks the draft text before voice started + all finalized speech segments
  const committedTextRef = useRef("");

  function startListening() {
    if (isListeningRef.current || !SpeechRecognition) return;
    isListeningRef.current = true;
    setIsListening(true);
    committedTextRef.current = inputRef.current;
    const recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = "en-US";
    recognition.onresult = (event: SpeechRecognitionEvent) => {
      let interimText = "";
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const t = event.results[i][0].transcript;
        if (event.results[i].isFinal) {
          committedTextRef.current = joinSpoken(committedTextRef.current, t);
        } else {
          interimText = joinSpoken(interimText, t);
        }
      }
      onTranscript(joinSpoken(committedTextRef.current, interimText));
      requestAnimationFrame(() => {
        onGrow();
      });
    };
    recognition.onend = () => {
      isListeningRef.current = false;
      setIsListening(false);
    };
    recognition.onerror = () => {
      isListeningRef.current = false;
      setIsListening(false);
    };
    recognitionRef.current = recognition;
    recognition.start();
  }

  function stopListening(opts?: { discard?: boolean }) {
    const recognition = recognitionRef.current;
    if (!recognition) return;
    if (opts?.discard) {
      recognition.onresult = null;
      recognition.abort();
      return;
    }
    recognition.stop();
  }

  function toggleListening() {
    if (isListeningRef.current) {
      stopListening();
    } else {
      startListening();
    }
  }

  // Ctrl+Space push-to-talk
  useEffect(() => {
    if (!speechAvailable) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.code === "Space" && e.ctrlKey && !e.shiftKey && !e.altKey && !e.metaKey && !e.repeat) {
        e.preventDefault();
        startListening();
      }
    }
    function onKeyUp(e: KeyboardEvent) {
      if (e.code === "Space" && !e.repeat) {
        stopListening();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      recognitionRef.current?.stop();
    };
  }, [speechAvailable]);

  return {
    isListening,
    startListening,
    stopListening,
    toggleListening,
    showMicHint,
    setShowMicHint,
    speechApiPresent,
    isSecureContext,
  };
}

export function joinSpoken(base: string, addition: string): string {
  if (!base) return addition;
  if (!addition) return base;
  if (/\s$/.test(base) || /^\s/.test(addition)) return base + addition;
  return `${base} ${addition}`;
}
