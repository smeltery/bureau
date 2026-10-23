import { useEffect, useRef, useState } from "react";
import { advanceDictationSession, isSpokenSubmit, reconcileDictationEdit, startDictationSession } from "../log-view/hooks/spoken-punctuation.ts";
import { browserRecorderDeps, createVoiceRecorder, type RecorderState } from "./recorder.ts";

export interface VoiceInputOptions {
  inputRef: React.MutableRefObject<string>;
  locale: string;
  onTranscript(text: string): void;
  onGrow(): void;
  sessionKey?: string;
}
export function useRecordedVoice(options: VoiceInputOptions, enabled: boolean) {
  const latest = useRef(options);
  latest.current = options;
  const [state, setState] = useState<RecorderState>("idle");
  const [voiceInputError, setError] = useState<string | null>(null);
  const [showMicHint, setShowMicHint] = useState(false);
  const session = useRef(startDictationSession("", options.locale));
  const controller = useRef<ReturnType<typeof createVoiceRecorder> | null>(null);
  controller.current ??= createVoiceRecorder(
    {
      state: setState,
      error: setError,
      transcript: (text) => {
        if (isSpokenSubmit(text, latest.current.locale)) {
          window.dispatchEvent(new CustomEvent("bureau:voice-submit"));
          return;
        }
        session.current = reconcileDictationEdit(session.current, latest.current.inputRef.current);
        session.current = advanceDictationSession(session.current, [text], "");
        latest.current.onTranscript(session.current.display);
        requestAnimationFrame(() => latest.current.onGrow());
      },
    },
    browserRecorderDeps,
  );
  const speechApiPresent = typeof MediaRecorder !== "undefined" && typeof navigator !== "undefined" && !!navigator.mediaDevices?.getUserMedia;
  const isSecureContext = typeof window !== "undefined" && window.isSecureContext;
  function startListening() {
    if (!enabled || !speechApiPresent || !isSecureContext || controller.current!.active()) return;
    setError(null);
    session.current = startDictationSession(latest.current.inputRef.current, latest.current.locale);
    void controller.current!.start();
  }
  function stopListening(opts?: { discard?: boolean }) {
    if (opts?.discard) controller.current!.cancel();
    else controller.current!.stop();
  }
  useEffect(() => {
    if (!enabled) return;
    let held = false;
    const down = (event: KeyboardEvent) => {
      if (event.code === "Space" && event.ctrlKey && !event.shiftKey && !event.altKey && !event.metaKey && !event.repeat) {
        event.preventDefault();
        held = true;
        startListening();
      }
    };
    const up = (event: KeyboardEvent) => {
      if (event.code === "Space" && !event.repeat && held) {
        held = false;
        stopListening();
      }
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      controller.current!.cancel();
    };
  }, [enabled, options.sessionKey, options.locale]);
  return {
    isListening: state !== "idle",
    startListening,
    stopListening,
    toggleListening: () => (controller.current!.active() ? stopListening() : startListening()),
    showMicHint,
    setShowMicHint,
    speechApiPresent,
    isSecureContext,
    voiceInputError,
    reconcileDraftEdit: (text: string) => {
      if (controller.current!.active()) session.current = reconcileDictationEdit(session.current, text);
    },
    voiceStatus: state === "transcribing" ? "Transcribing…" : state === "requesting" ? "Waiting for microphone…" : null,
  };
}
