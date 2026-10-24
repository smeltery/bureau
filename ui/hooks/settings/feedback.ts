import { MIN_HANDOFF_TOKENS, MAX_HANDOFF_TOKENS, type HandoffSettingsIssue } from "../../../shared/agents/handoff.ts";
import type { PlainMessageKey, Translator } from "../../../shared/i18n/translate.ts";

export type SettingsFailure = string | { key: PlainMessageKey } | { memoryStatus: number } | { memoryLoadStatus: number } | { handoff: HandoffSettingsIssue };

export function settingsFailureText(failure: SettingsFailure, t: Translator["t"], language = "en"): string {
  if (typeof failure === "string") return failure;
  if ("handoff" in failure)
    return failure.handoff === "autoHandoff"
      ? t("agentSettings.handoffBoolean")
      : t("agentSettings.handoffRange", { min: MIN_HANDOFF_TOKENS.toLocaleString(language), max: MAX_HANDOFF_TOKENS.toLocaleString(language) });
  if ("key" in failure) return t(failure.key);
  return "memoryStatus" in failure ? t("settingsUi.memoryHttp", { status: failure.memoryStatus }) : t("settingsUi.memoryLoadHttp", { status: failure.memoryLoadStatus });
}
