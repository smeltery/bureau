export type VoiceProvider = "browser" | "openai";
export const VOICE_NAMES = ["alloy", "ash", "ballad", "coral", "echo", "sage", "shimmer", "verse", "marin", "cedar"] as const;
export type VoiceName = (typeof VOICE_NAMES)[number];
export const DEFAULT_VOICE_NAME: VoiceName = "marin";
export const MAX_VOICE_AUDIO_BYTES = 25 * 1024 * 1024;
export const MAX_VOICE_RECORDING_MS = 20 * 60 * 1000;
export const MAX_SPEAK_CHARS = 4096;
export const VOICE_AUDIO_TYPES: Record<string, string> = { "audio/webm": "webm", "audio/mp4": "mp4", "audio/mpeg": "mp3", "audio/wav": "wav", "audio/x-wav": "wav" };
export function isVoiceProvider(value: unknown): value is VoiceProvider {
  return value === "browser" || value === "openai";
}
export function isVoiceName(value: unknown): value is VoiceName {
  return typeof value === "string" && (VOICE_NAMES as readonly string[]).includes(value);
}
export interface VoiceStatus {
  keyName: string | null;
  keySource: "member" | "office" | "server" | null;
  available: boolean;
}
