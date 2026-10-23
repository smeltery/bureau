import type { VoiceStatus } from "../../shared/integrations/voice.ts";
import { integrationStore, type StoredSecret } from "../integrations/store.ts";
import { getOfficeSettings } from "../agents/state.ts";
import { readEnvFile } from "../persistence/env-file.ts";
import { getUserById } from "../users.ts";

type Layer = { source: NonNullable<VoiceStatus["keySource"]>; values: Record<string, string | undefined>; secrets?: StoredSecret[] };
export type VoiceCredential = VoiceStatus & { key: string | null };
export function selectVoiceCredential(layers: Layer[]): VoiceCredential {
  for (const name of ["OPENAI_VOICE_API_KEY", "OPENAI_API_KEY"]) {
    for (const layer of layers) {
      const secret = layer.secrets?.find((item) => item.name === name);
      const value = secret ? secret.value : layer.values[name];
      if (!value) continue;
      const allowed = !secret || (secret.hosts.includes("api.openai.com") && secret.form.kind === "authorization");
      const key = allowed && !/[\x00-\x20\x7f]/.test(value) ? value : null;
      return { key, keyName: name, keySource: layer.source, available: key !== null };
    }
  }
  return { key: null, keyName: null, keySource: null, available: false };
}
export function voiceCredential(userId: string): VoiceCredential {
  const user = getUserById(userId);
  if (!user) throw new Error("Member unavailable.");
  const office = getOfficeSettings();
  return selectVoiceCredential([
    { source: "member", values: user.envFile ? readEnvFile(user.envFile) : {}, secrets: integrationStore.privateSecrets({ kind: "member", userId }) },
    { source: "office", values: office.envFile ? readEnvFile(office.envFile) : {}, secrets: integrationStore.privateSecrets({ kind: "office" }) },
    { source: "server", values: process.env },
  ]);
}
