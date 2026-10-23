import { VOICE_AUDIO_TYPES } from "../../shared/integrations/voice.ts";
import { readVoiceBytes, VoiceError } from "./limits.ts";

export async function transcribeAudio(bytes: Uint8Array, mime: string, key: string, signal: AbortSignal, fetcher: typeof fetch = fetch): Promise<string> {
  const extension = VOICE_AUDIO_TYPES[mime];
  if (!extension || !bytes.length) throw new VoiceError("Record a supported audio clip.");
  const form = new FormData();
  form.set("file", new Blob([bytes as BlobPart], { type: mime }), `recording.${extension}`);
  form.set("model", "gpt-transcribe");
  const response = await fetcher("https://api.openai.com/v1/audio/transcriptions", { method: "POST", headers: { Authorization: `Bearer ${key}` }, body: form, signal, redirect: "error" });
  if (!response.ok) {
    void response.body?.cancel().catch(() => {});
    throw new VoiceError(
      response.status === 429 ? "OpenAI voice usage limit reached. Try again later." : "OpenAI could not transcribe this recording. Check your voice credential and try again.",
      502,
    );
  }
  const data = JSON.parse(new TextDecoder().decode(await readVoiceBytes(response.body, 1024 * 1024, signal)));
  if (typeof data.text !== "string") throw new VoiceError("OpenAI returned an invalid transcript.", 502);
  return data.text;
}
