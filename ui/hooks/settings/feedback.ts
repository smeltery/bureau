import type { PlainMessageKey, Translator } from "../../../shared/i18n/translate.ts";

export type SettingsFailure = string | { key: PlainMessageKey } | { memoryStatus: number };

export function settingsFailureText(failure: SettingsFailure, t: Translator["t"]): string {
  if (typeof failure === "string") return failure;
  return "key" in failure ? t(failure.key) : t("settingsUi.memoryHttp", { status: failure.memoryStatus });
}
