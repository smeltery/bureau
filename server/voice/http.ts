import type { AuthResult } from "../auth/auth-middleware.ts";
import { getUserById } from "../users.ts";
import { DEFAULT_VOICE_NAME, isVoiceName, MAX_SPEAK_CHARS, MAX_VOICE_AUDIO_BYTES, VOICE_AUDIO_TYPES } from "../../shared/integrations/voice.ts";
import { voiceCredential } from "./credentials.ts";
import { readVoiceBytes, VoiceError } from "./limits.ts";
import { transcribeAudio } from "./transcribe.ts";
import { speakText } from "./speak.ts";

const headers = { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" };
const json = (body: unknown, status = 200) => Response.json(body, { status, headers });
export function createVoiceHandler(deps = { credential: voiceCredential, transcribe: transcribeAudio, speak: speakText, getUser: getUserById }) {
  const active = new Set<string>();
  return async (req: Request, url: URL, authenticate: () => AuthResult): Promise<Response | null> => {
    if (url.pathname !== "/api/voice" && !url.pathname.startsWith("/api/voice/")) return null;
    const auth = authenticate();
    if (auth.kind !== "ok" || req.headers.has("authorization")) return json({ error: "Browser sign-in required." }, 401);
    const userId = auth.session.userId;
    const authorized = () => {
      const current = authenticate();
      return current.kind === "ok" && current.session.userId === userId && deps.getUser(userId) !== null;
    };
    if (!authorized()) return json({ error: "Browser sign-in required." }, 401);
    try {
      if (url.pathname === "/api/voice" && req.method === "GET") {
        const { key: _, ...status } = deps.credential(userId);
        return json(status);
      }
      if (url.pathname !== "/api/voice/transcribe" && url.pathname !== "/api/voice/speak") return json({ error: "Not found." }, 404);
      if (req.method !== "POST") return json({ error: "Method not allowed." }, 405);
      if (active.has(userId) || active.size >= 8) return json({ error: "Another voice request is running. Try again shortly." }, 429);
      active.add(userId);
      const signal = AbortSignal.any([req.signal, AbortSignal.timeout(120_000)]);
      try {
        const isTranscription = url.pathname.endsWith("/transcribe");
        const mime = (req.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
        if (isTranscription ? !Object.hasOwn(VOICE_AUDIO_TYPES, mime) : mime !== "application/json") throw new VoiceError("Unsupported voice content type.", 415);
        const bytes = await readVoiceBytes(req.body, isTranscription ? MAX_VOICE_AUDIO_BYTES : 32 * 1024, signal);
        if (!authorized()) return json({ error: "Browser sign-in required." }, 401);
        const credential = deps.credential(userId);
        if (!credential.key)
          return json({ error: "Configure OPENAI_VOICE_API_KEY in Integrations before using OpenAI voice. Secrets must allow api.openai.com with Authorization authentication." }, 422);
        let response: Response;
        if (isTranscription) {
          const text = await deps.transcribe(bytes, mime, credential.key, signal);
          response = json({ text });
        } else {
          let body: unknown;
          try {
            body = JSON.parse(new TextDecoder().decode(bytes));
          } catch {
            throw new VoiceError("Invalid voice request.");
          }
          if (!body || typeof body !== "object" || !("text" in body) || typeof body.text !== "string" || !body.text.trim() || body.text.length > MAX_SPEAK_CHARS)
            throw new VoiceError(`Choose text between 1 and ${MAX_SPEAK_CHARS} characters.`);
          const voice = "voice" in body ? body.voice : (deps.getUser(userId)?.voiceName ?? DEFAULT_VOICE_NAME);
          if (!isVoiceName(voice)) throw new VoiceError("Choose a supported voice.");
          const audio = await deps.speak(body.text, voice, credential.key, signal);
          response = new Response(audio as BodyInit, { headers: { ...headers, "Content-Type": "audio/wav" } });
        }
        if (!authorized()) return json({ error: "Browser sign-in required." }, 401);
        signal.throwIfAborted();
        return response;
      } finally {
        active.delete(userId);
      }
    } catch (error) {
      if (error instanceof VoiceError) return json({ error: error.message }, error.status);
      if (error instanceof Error && (error.name === "AbortError" || error.name === "TimeoutError")) return json({ error: "Voice request cancelled or timed out." }, 408);
      return json({ error: "Voice request failed. Check your voice configuration and try again." }, 502);
    }
  };
}
export const handleVoiceRequest = createVoiceHandler();
