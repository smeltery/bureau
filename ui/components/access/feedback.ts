import type { PlainMessageKey, Translator } from "../../../shared/i18n/translate.ts";

export type AccessFailure = string | { key: PlainMessageKey };

export function revokeFailure(message: { reason: string; reasonCode?: string }): AccessFailure {
  if (message.reasonCode === "last_owner_session") return { key: "accessUi.lastOwner" };
  if (message.reasonCode === "last_owner_logout") return { key: "accessUi.lastOwnerLogout" };
  return message.reason;
}

export function accessFailureText(failure: AccessFailure, t: Translator["t"]): string {
  return typeof failure === "string" ? failure : t(failure.key);
}
