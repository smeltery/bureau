import type { PlainMessageKey, Translator } from "../../../shared/i18n/translate.ts";

export type SettingsFailure = string | { key: PlainMessageKey } | { memoryStatus: number } | { memoryLoadStatus: number };

export function settingsFailureText(failure: SettingsFailure, t: Translator["t"]): string {
  if (typeof failure === "string") return failure;
  if ("key" in failure) return t(failure.key);
  return "memoryStatus" in failure ? t("settingsUi.memoryHttp", { status: failure.memoryStatus }) : t("settingsUi.memoryLoadHttp", { status: failure.memoryLoadStatus });
}
