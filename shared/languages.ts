export const SUPPORTED_LANGUAGES = [
  { code: "en", label: "English", englishName: "English", speechLocale: "en-US" },
  { code: "es", label: "Espanol", englishName: "Spanish", speechLocale: "es-ES" },
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

export function speechLocaleFor(language: SupportedLanguageCode | null | undefined, navigatorLanguage: string | null | undefined): string {
  const picked = languageOption(language);
  if (picked) return picked.speechLocale;
  return typeof navigatorLanguage === "string" && navigatorLanguage.trim() ? navigatorLanguage : "en-US";
}
