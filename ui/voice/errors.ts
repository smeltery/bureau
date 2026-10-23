import { translatorFor, type PlainMessageKey, type Translator } from "../../shared/i18n/translate.ts";

export type VoiceMessageKey = Extract<PlainMessageKey, `voice.${string}`>;
export type VoiceFailure = string | { key: VoiceMessageKey };

export class VoiceError extends Error {
  constructor(readonly key: VoiceMessageKey) {
    super(translatorFor("en").t(key));
  }
}

export function voiceFailure(error: unknown, fallback: VoiceMessageKey): VoiceFailure {
  return error instanceof VoiceError ? { key: error.key } : error instanceof Error ? error.message : { key: fallback };
}

export function voiceFailureText(error: VoiceFailure, t: Translator["t"]): string {
  return typeof error === "string" ? error : t(error.key);
}
