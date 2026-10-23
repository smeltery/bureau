import { translatorFor } from "../../../shared/i18n/translate.ts";
import type { VoiceMessageKey } from "../../voice/errors.ts";

const VOICE_INPUT_ERROR_KEYS: Record<string, VoiceMessageKey> = {
  "not-allowed": "voice.blocked",
  "service-not-allowed": "voice.blocked",
  "audio-capture": "voice.noMicrophone",
  network: "voice.network",
};

export function voiceInputErrorKey(code: string): VoiceMessageKey | null {
  if (code === "no-speech" || code === "aborted") return null;
  return Object.hasOwn(VOICE_INPUT_ERROR_KEYS, code) ? VOICE_INPUT_ERROR_KEYS[code] : "voice.inputFailed";
}

export function voiceInputErrorMessage(code: string): string | null {
  const key = voiceInputErrorKey(code);
  return key === null ? null : translatorFor("en").t(key);
}
