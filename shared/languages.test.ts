import { describe, expect, test } from "bun:test";
import { DEFAULT_LANGUAGE, detectBrowserLanguage, displayLanguage, isSupportedLanguage, languageOption, speechLocaleFor, SUPPORTED_LANGUAGES } from "./languages.ts";

describe("language helpers", () => {
  test("default language is supported", () => {
    expect(isSupportedLanguage(DEFAULT_LANGUAGE)).toBe(true);
  });

  test("offers English, Spanish, and Catalan", () => {
    expect(SUPPORTED_LANGUAGES.map((language) => language.code)).toEqual(["en", "es", "ca"]);
    expect(languageOption("ca")?.englishName).toBe("Catalan");
    expect(languageOption("ca")?.speechLocale).toBe("ca-ES");
  });

  test("detects supported browser primary subtags", () => {
    expect(detectBrowserLanguage("es-MX")).toBe("es");
    expect(detectBrowserLanguage("ca-ES")).toBe("ca");
    expect(detectBrowserLanguage("EN-us")).toBe("en");
    expect(detectBrowserLanguage("fr-FR")).toBeNull();
    expect(detectBrowserLanguage(null)).toBeNull();
  });

  test("displayLanguage prefers the saved preference over the browser", () => {
    expect(displayLanguage({ language: "en" }, "es-ES")).toBe("en");
    expect(displayLanguage({ language: "ca" }, "en-US")).toBe("ca");
    expect(displayLanguage({ language: null }, "ca-ES")).toBe("ca");
    expect(displayLanguage(null, "es-MX")).toBe("es");
    expect(displayLanguage(null, "fr-FR")).toBe("en");
  });

  test("maps persisted language to prompt and speech metadata", () => {
    expect(languageOption("es")?.englishName).toBe("Spanish");
    expect(languageOption(null)).toBeNull();
    expect(speechLocaleFor("es", "en-GB")).toBe("es-ES");
    expect(speechLocaleFor("ca", "en-GB")).toBe("ca-ES");
    expect(speechLocaleFor(null, "fr-FR")).toBe("fr-FR");
    expect(speechLocaleFor(null, "")).toBe("en-US");
  });
});
