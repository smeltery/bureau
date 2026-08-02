import { speechLocaleFor } from "../../shared/languages.ts";
import { useAppState } from "../store.tsx";

export function useSpeechLocale(): string {
  const { sessionContext, users } = useAppState();
  const self = sessionContext ? users.get(sessionContext.username.trim().toLocaleLowerCase()) : undefined;
  const navigatorLanguage = typeof navigator === "undefined" ? null : navigator.language;
  return speechLocaleFor(self?.language ?? null, navigatorLanguage);
}
