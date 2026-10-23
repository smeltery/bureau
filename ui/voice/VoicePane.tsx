import { useI18n } from "../i18n.tsx";
import { useEffect, useState } from "react";
import { DEFAULT_VOICE_NAME, VOICE_NAMES, type VoiceStatus } from "../../shared/integrations/voice.ts";
import type { UserRecord } from "../../shared/types.ts";
import { useAppState, useDispatch } from "../store.tsx";
import { integrationApi, integrationFailure, integrationFailureText, type IntegrationFailure } from "../components/integrations/scoped/api.ts";
import { dialogHint, dialogInput, dialogLabel, dialogCancelBtn } from "../components/modals/dialog-styles.ts";

export function VoicePane() {
  const { t } = useI18n();
  const { sessionContext, users } = useAppState();
  const dispatch = useDispatch();
  const user = sessionContext ? [...users.values()].find((member) => member.id === sessionContext.userId) : undefined;
  const [status, setStatus] = useState<VoiceStatus | null>(null);
  const [error, setError] = useState<IntegrationFailure | null>(null);
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
        if (active) setError(integrationFailure(caught, "voice.checkFailed"));
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
      setError(integrationFailure(caught, "voice.saveFailed"));
    } finally {
      setSaving(false);
    }
  }
  return (
    <section aria-label={t("voice.title")}>
      <p style={dialogHint}>{t("voice.hint")}</p>
      {(["voiceInput", "voiceOutput"] as const).map((field) => (
        <label key={field} style={dialogLabel}>
          {field === "voiceInput" ? t("voice.microphone") : t("voice.readAloud")}
          <select
            aria-label={field === "voiceInput" ? t("voice.microphone") : t("voice.readAloud")}
            style={dialogInput}
            disabled={saving}
            value={user[field] ?? "browser"}
            onChange={(event) => void save({ [field]: event.target.value })}
          >
            <option value="browser">{t("voice.browser")}</option>
            <option value="openai">OpenAI</option>
          </select>
        </label>
      ))}
      <label style={dialogLabel}>
        {t("voice.name")}
        <select
          aria-label={t("voice.name")}
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
      <p style={dialogHint}>{t("voice.disclosure")}</p>
      <p style={dialogHint}>
        {status
          ? status.available
            ? t("voice.using", { key: String(status.keyName), source: status.keySource ? t(`voice.${status.keySource}`) : String(status.keySource) })
            : status.keyName
              ? t("voice.unavailable", { key: status.keyName })
              : t("voice.configure")
          : t("voice.checking")}
      </p>
      <button style={dialogCancelBtn} onClick={() => setRevision((value) => value + 1)}>
        {t("voice.refresh")}
      </button>
      {error && <p role="alert">{integrationFailureText(error, t)}</p>}
    </section>
  );
}
