import { useEffect, useRef, useState } from "react";
import { advanceDictationSession, reconcileDictationEdit, startDictationSession, type DictationSession } from "./spoken-punctuation.ts";
import { voiceInputErrorMessage } from "./voice-input-error.ts";

/**
 * Speech-recognition input.
 *
 * Dictation appends to whatever's already in the draft. Ctrl+Space is the
 * global hold-to-talk shortcut; the mic button toggles dictation.
 *
 * Spoken punctuation ("question mark" → "?") is applied by
 * spoken-punctuation.ts, which needs the recognizer's FRAGMENTS rather than one
 * accumulated string: whether "period" is a full stop or the word depends on it
 * ending the fragment it arrived in. So the session keeps the finalized
 * transcripts separately and recomputes the composer text, which also means a
 * revised interim guess re-decides instead of leaving a stale substitution
 * behind.
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
export function useVoiceInput({ inputRef, locale, onTranscript, onGrow }: { inputRef: React.MutableRefObject<string>; locale: string; onTranscript: (text: string) => void; onGrow: () => void }) {
  const SpeechRecognition = (typeof window !== "undefined" && ((window as any).SpeechRecognition || (window as any).webkitSpeechRecognition)) || null;
  const isSecureContext = typeof window !== "undefined" && window.isSecureContext;
  const speechApiPresent = !!SpeechRecognition;
  const speechAvailable = speechApiPresent && isSecureContext;

  const [isListening, setIsListening] = useState(false);
  const isListeningRef = useRef(false);
  const [showMicHint, setShowMicHint] = useState(false);
  const [voiceInputError, setVoiceInputError] = useState<string | null>(null);
  const recognitionRef = useRef<SpeechRecognition | null>(null);
  // The draft text as it stood when the mic opened, plus every finalized
  // fragment since — kept unjoined so punctuation can be decided per fragment.
  // `display` additionally tracks the last STT-produced draft so manual edits
  // during dictation can rebase the finalized baseline instead of getting
  // overwritten by the next recognizer update.
  const dictationRef = useRef<DictationSession>(startDictationSession("", "en"));

  function startListening() {
    if (isListeningRef.current || !SpeechRecognition) return;
    setVoiceInputError(null);
    isListeningRef.current = true;
    setIsListening(true);
    dictationRef.current = startDictationSession(inputRef.current, locale);
    const recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = locale;
    recognition.onresult = (event: SpeechRecognitionEvent) => {
      // The interim guess is NOT folded into the session: it is still being
      // revised, and a terminal command can stop being fragment-final as the
      // guess grows.
      const finalized: string[] = [];
      let interimText = "";
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const t = event.results[i][0].transcript;
        if (event.results[i].isFinal) {
          finalized.push(t);
        } else {
          interimText += t;
        }
      }
      dictationRef.current = advanceDictationSession(dictationRef.current, finalized, interimText);
      onTranscript(dictationRef.current.display);
      requestAnimationFrame(() => {
        onGrow();
      });
    };
    recognition.onend = () => {
      isListeningRef.current = false;
      setIsListening(false);
    };
    recognition.onerror = (event: SpeechRecognitionErrorEvent) => {
      isListeningRef.current = false;
      setIsListening(false);
      const message = voiceInputErrorMessage(event.error);
      if (message) setVoiceInputError(message);
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

  function reconcileDraftEdit(text: string) {
    if (!isListeningRef.current) return;
    dictationRef.current = reconcileDictationEdit(dictationRef.current, text);
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
  }, [speechAvailable, locale]);

  return {
    isListening,
    startListening,
    stopListening,
    toggleListening,
    showMicHint,
    setShowMicHint,
    speechApiPresent,
    isSecureContext,
    voiceInputError,
    reconcileDraftEdit,
  };
}
