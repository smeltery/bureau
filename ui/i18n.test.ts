import { describe, expect, test } from "bun:test";
import { createElement } from "react";
import { displayLanguage } from "../shared/languages.ts";
import { translatorFor } from "../shared/i18n/translate.ts";
import { renderRich, uiTranslatorFor } from "./i18n.tsx";

describe("ui i18n smoke", () => {
  test("uiTranslatorFor follows displayLanguage for Catalan", () => {
    const language = displayLanguage({ language: "ca" }, "en-US");
    const { t } = uiTranslatorFor(language);
    expect(t("common.save")).toBe("Desa");
    expect(t("office.empty.newAgent")).toBe("Agent nou");
    expect(t("preferences.languageHint")).toContain("oficina");
  });

  test("Spanish engine blurbs match the catalog", () => {
    const { t } = translatorFor("es");
    expect(t("dialogs.agent.engineBlurb.claude")).toBe("Funciona con tu cuenta de Claude Code.");
    expect(t("connections.title")).toBe("Conexiones");
  });

  test("renderRich wraps tagged spans", () => {
    const node = renderRich("Run <code>bun install</code>", {
      code: (chunk) => createElement("code", null, chunk),
    });
    expect(node).toBeTruthy();
  });
});
