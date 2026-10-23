import { useI18n } from "../i18n.tsx";
import { voiceFailure, voiceFailureText, type VoiceFailure } from "./errors.ts";
import { useEffect, useRef, useState } from "react";
import { useSpeechLocale } from "../hooks/useSpeechLocale.ts";
import { useVoicePreferences } from "./useVoicePreferences.ts";
import { readAloud } from "./playback.ts";

let stopActive: (() => void) | null = null;
export function useReadAloud(getText: () => string) {
  const { t } = useI18n();
  const preferences = useVoicePreferences();
  const locale = useSpeechLocale();
  const [speaking, setSpeaking] = useState(false);
  const [error, setError] = useState<VoiceFailure | null>(null);
  const run = useRef<{ stop(): void } | null>(null);
  function stop() {
    run.current?.stop();
  }
  useEffect(() => stop, [preferences.userId, preferences.output, preferences.voice, locale]);
  function toggle() {
    if (run.current) {
      stop();
      return;
    }
    const text = getText();
    if (!text) return;
    stopActive?.();
    setError(null);
    setSpeaking(true);
    const abort = new AbortController();
    let utterance: SpeechSynthesisUtterance | null = null;
    const entry = {
      stop: () => {
        abort.abort();
        if (utterance) {
          utterance.onend = null;
          utterance.onerror = null;
          speechSynthesis.cancel();
        }
        if (run.current === entry) {
          run.current = null;
          setSpeaking(false);
        }
        if (stopActive === entry.stop) stopActive = null;
      },
    };
    run.current = entry;
    stopActive = entry.stop;
    if (preferences.output === "openai") {
      void readAloud(text, preferences.voice, abort.signal)
        .catch((caught) => {
          if (!abort.signal.aborted) setError(voiceFailure(caught, "voice.readFailed"));
        })
        .finally(() => {
          if (run.current === entry) entry.stop();
        });
    } else {
      try {
        utterance = new SpeechSynthesisUtterance(text);
        const normalized = (value: string) => value.replace("_", "-").toLowerCase();
        const voices = speechSynthesis.getVoices();
        const exact = voices.filter((voice) => normalized(voice.lang) === normalized(locale));
        const candidates = exact.length ? exact : voices.filter((voice) => normalized(voice.lang).split("-")[0] === normalized(locale).split("-")[0]);
        const voice =
          candidates.find((candidate) => /google/i.test(candidate.name)) ??
          candidates.find((candidate) => candidate.default) ??
          candidates[0] ??
          voices.find((candidate) => candidate.default) ??
          voices[0];
        if (voice) utterance.voice = voice;
        utterance.lang = locale;
        utterance.onend = entry.stop;
        utterance.onerror = () => {
          setError({ key: "voice.browserFailed" });
          entry.stop();
        };
        speechSynthesis.speak(utterance);
      } catch {
        setError({ key: "voice.browserUnavailable" });
        entry.stop();
      }
    }
  }
  return {
    speaking,
    error: error === null ? null : voiceFailureText(error, t),
    toggle,
    available: preferences.output === "openai" || typeof speechSynthesis !== "undefined",
    provider: preferences.output,
  };
}
