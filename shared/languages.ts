export const SUPPORTED_LANGUAGES = [
  { code: "en", label: "English", englishName: "English", speechLocale: "en-US" },
  { code: "es", label: "Espanol", englishName: "Spanish", speechLocale: "es-ES" },
  { code: "ca", label: "Català", englishName: "Catalan", speechLocale: "ca-ES" },
  { code: "zh", label: "简体中文", englishName: "Simplified Chinese", speechLocale: "zh-CN" },
] as const;

export type SupportedLanguageCode = (typeof SUPPORTED_LANGUAGES)[number]["code"];

export const DEFAULT_LANGUAGE: SupportedLanguageCode = "en";

export function isSupportedLanguage(value: unknown): value is SupportedLanguageCode {
  return typeof value === "string" && SUPPORTED_LANGUAGES.some((language) => language.code === value);
}

export function languageOption(code: SupportedLanguageCode | null | undefined) {
  if (!code) return null;
  return SUPPORTED_LANGUAGES.find((language) => language.code === code) ?? null;
}

export function detectBrowserLanguage(navigatorLanguage: string | null | undefined): SupportedLanguageCode | null {
  if (typeof navigatorLanguage !== "string") return null;
  const primary = navigatorLanguage.split("-")[0]?.toLowerCase();
  return SUPPORTED_LANGUAGES.find((language) => language.code === primary)?.code ?? null;
}

/** Effective UI language: saved preference, else supported browser language, else English. */
export function displayLanguage(record: { language: SupportedLanguageCode | null } | null | undefined, navigatorLanguage: string | null | undefined): SupportedLanguageCode {
  return record?.language ?? detectBrowserLanguage(navigatorLanguage) ?? DEFAULT_LANGUAGE;
}

export function speechLocaleFor(language: SupportedLanguageCode | null | undefined, navigatorLanguage: string | null | undefined): string {
  const picked = languageOption(language);
  if (picked) return picked.speechLocale;
  return typeof navigatorLanguage === "string" && navigatorLanguage.trim() ? navigatorLanguage : "en-US";
}
