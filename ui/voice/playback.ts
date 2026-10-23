import { VoiceError } from "./errors.ts";
import { MAX_SPEAK_CHARS, type VoiceName } from "../../shared/integrations/voice.ts";

export function speechChunks(text: string): string[] {
  const chunks: string[] = [];
  let remaining = text.trim();
  while (remaining.length > MAX_SPEAK_CHARS) {
    let end = remaining.lastIndexOf(" ", MAX_SPEAK_CHARS);
    if (end < MAX_SPEAK_CHARS / 2) end = MAX_SPEAK_CHARS;
    if (/[\uD800-\uDBFF]/.test(remaining[end - 1])) end--;
    chunks.push(remaining.slice(0, end));
    remaining = remaining.slice(end).trimStart();
  }
  if (remaining) chunks.push(remaining);
  return chunks;
}
export async function playAudioBlob(blob: Blob, signal: AbortSignal): Promise<void> {
  signal.throwIfAborted();
  const url = URL.createObjectURL(blob);
  const audio = new Audio(url);
  try {
    await new Promise<void>((resolve, reject) => {
      const cleanup = () => {
        signal.removeEventListener("abort", abort);
        audio.onended = null;
        audio.onerror = null;
      };
      const finish = (error?: Error) => {
        cleanup();
        if (error) reject(error);
        else resolve();
      };
      const abort = () => finish(new DOMException("Playback cancelled.", "AbortError"));
      audio.onended = () => finish();
      audio.onerror = () => finish(new VoiceError("voice.playFailed"));
      signal.addEventListener("abort", abort, { once: true });
      void audio.play().catch(() => finish(new VoiceError("voice.playBlocked")));
      if (signal.aborted) abort();
    });
  } finally {
    audio.pause();
    audio.removeAttribute("src");
    audio.load();
    URL.revokeObjectURL(url);
  }
}
export async function readAloud(text: string, voice: VoiceName, signal: AbortSignal, fetcher: typeof fetch = fetch, play = playAudioBlob) {
  for (const chunk of speechChunks(text)) {
    signal.throwIfAborted();
    const response = await fetcher("/api/voice/speak", {
      method: "POST",
      credentials: "same-origin",
      signal,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: chunk, voice }),
    });
    if (!response.ok) {
      const body = await response.json();
      throw body.error ? new Error(body.error) : new VoiceError("voice.readFailedHint");
    }
    const blob = await response.blob();
    signal.throwIfAborted();
    await play(blob, signal);
  }
}
