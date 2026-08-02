import { describe, expect, test } from "bun:test";
import { DEFAULT_LANGUAGE, detectBrowserLanguage, isSupportedLanguage, languageOption, speechLocaleFor } from "./languages.ts";

describe("language helpers", () => {
  test("default language is supported", () => {
    expect(isSupportedLanguage(DEFAULT_LANGUAGE)).toBe(true);
  });

  test("detects supported browser primary subtags", () => {
    expect(detectBrowserLanguage("es-MX")).toBe("es");
    expect(detectBrowserLanguage("EN-us")).toBe("en");
    expect(detectBrowserLanguage("fr-FR")).toBeNull();
    expect(detectBrowserLanguage(null)).toBeNull();
  });

  test("maps persisted language to prompt and speech metadata", () => {
    expect(languageOption("es")?.englishName).toBe("Spanish");
    expect(languageOption(null)).toBeNull();
    expect(speechLocaleFor("es", "en-GB")).toBe("es-ES");
    expect(speechLocaleFor(null, "fr-FR")).toBe("fr-FR");
    expect(speechLocaleFor(null, "")).toBe("en-US");
  });
});
