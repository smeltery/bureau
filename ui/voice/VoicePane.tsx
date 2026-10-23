import { useEffect, useState } from "react";
import { DEFAULT_VOICE_NAME, VOICE_NAMES, type VoiceStatus } from "../../shared/integrations/voice.ts";
import type { UserRecord } from "../../shared/types.ts";
import { useAppState, useDispatch } from "../store.tsx";
import { integrationApi } from "../components/integrations/scoped/api.ts";
import { dialogHint, dialogInput, dialogLabel, dialogCancelBtn } from "../components/modals/dialog-styles.ts";

export function VoicePane() {
  const { sessionContext, users } = useAppState();
  const dispatch = useDispatch();
  const user = sessionContext ? [...users.values()].find((member) => member.id === sessionContext.userId) : undefined;
  const [status, setStatus] = useState<VoiceStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    let active = true;
    setStatus(null);
    setError(null);
    void integrationApi<VoiceStatus>("/api/voice")
      .then((result) => {
        if (active) setStatus(result);
      })
      .catch((caught) => {
        if (active) setError(caught.message);
      });
    return () => {
      active = false;
    };
  }, [user?.id, revision]);
  if (!user) return null;
  async function save(changes: Partial<Pick<UserRecord, "voiceInput" | "voiceOutput" | "voiceName">>) {
    if (!user || saving) return;
    setSaving(true);
    setError(null);
    try {
      const result = await integrationApi<{ user: UserRecord }>(`/api/users/${encodeURIComponent(user.name)}`, "PATCH", changes);
      dispatch({ type: "voice_preferences", userId: result.user.id, changes: { voiceInput: result.user.voiceInput, voiceOutput: result.user.voiceOutput, voiceName: result.user.voiceName } });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not save voice preferences.");
    } finally {
      setSaving(false);
    }
  }
  return (
    <section aria-label="Voice preferences">
      <p style={dialogHint}>Choose the microphone and read-aloud providers for your account across devices. Browser voice stays available without an API key.</p>
      {(["voiceInput", "voiceOutput"] as const).map((field) => (
        <label key={field} style={dialogLabel}>
          {field === "voiceInput" ? "Microphone" : "Read aloud"}
          <select
            aria-label={field === "voiceInput" ? "Microphone" : "Read aloud"}
            style={dialogInput}
            disabled={saving}
            value={user[field] ?? "browser"}
            onChange={(event) => void save({ [field]: event.target.value })}
          >
            <option value="browser">Browser</option>
            <option value="openai">OpenAI</option>
          </select>
        </label>
      ))}
      <label style={dialogLabel}>
        OpenAI voice
        <select
          aria-label="OpenAI voice"
          style={dialogInput}
          disabled={saving}
          value={user.voiceName ?? DEFAULT_VOICE_NAME}
          onChange={(event) => void save({ voiceName: event.target.value as UserRecord["voiceName"] })}
        >
          {VOICE_NAMES.map((voice) => (
            <option key={voice} value={voice}>
              {voice}
            </option>
          ))}
        </select>
      </label>
      <p style={dialogHint}>OpenAI receives recorded audio for transcription and message text for read aloud. Its voice is AI-generated, and API usage is billed to the configured account.</p>
      <p style={dialogHint}>
        {status
          ? status.available
            ? `Using ${status.keyName} from ${status.keySource} settings.`
            : status.keyName
              ? `${status.keyName} is configured but unavailable. Secrets must allow api.openai.com with Authorization authentication.`
              : "Add OPENAI_VOICE_API_KEY under Secrets or Variables in your member scope, or ask an owner to configure it for the office. OPENAI_API_KEY is used if no dedicated voice key exists."
          : "Checking voice configuration…"}
      </p>
      <button style={dialogCancelBtn} onClick={() => setRevision((value) => value + 1)}>
        Refresh key status
      </button>
      {error && <p role="alert">{error}</p>}
    </section>
  );
}
