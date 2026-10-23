import { DEFAULT_VOICE_NAME } from "../../shared/integrations/voice.ts";
import { useAppState } from "../store.tsx";
export function useVoicePreferences() {
  const { sessionContext, users } = useAppState();
  const user = sessionContext ? [...users.values()].find((member) => member.id === sessionContext.userId) : undefined;
  return { userId: user?.id, input: user?.voiceInput ?? "browser", output: user?.voiceOutput ?? "browser", voice: user?.voiceName ?? DEFAULT_VOICE_NAME };
}
