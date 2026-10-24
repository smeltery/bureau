import { SUPPORTED_LANGUAGES, type SupportedLanguageCode } from "../../../shared/languages.ts";
import { translatorFor, type PlainMessageKey, type Translator } from "../../../shared/i18n/translate.ts";
import { authPageTitle, baseHtml, escapeHtml, escapeAttr, PREAUTH_EXTRA_CSS } from "../auth-html.ts";

export type AuthPageError = string | { key: PlainMessageKey } | null;
export function errorHtml(error: AuthPageError, t: Translator["t"]): string {
  return error ? `<p class="err" role="alert">${escapeHtml(typeof error === "string" ? error : t(error.key))}</p>` : "";
}

function scriptJson(value: unknown): string {
  return JSON.stringify(value).replaceAll("<", "\\u003c").replaceAll("\u2028", "\\u2028").replaceAll("\u2029", "\\u2029");
}

/** Switching page language never navigates or submits a one-time invite. */
export function authDocument(
  officeName: string | null,
  titleKey: PlainMessageKey,
  render: (t: Translator["t"]) => string,
  language: SupportedLanguageCode = "en",
  descriptionKey?: PlainMessageKey,
): string {
  const pages = Object.fromEntries(
    SUPPORTED_LANGUAGES.map(({ code }) => {
      const { t } = translatorFor(code);
      const hidden = `<input type="hidden" name="language" value="${code}" />`;
      return [
        code,
        {
          body: render(t).replaceAll("</form>", `${hidden}</form>`),
          title: authPageTitle(officeName, t(titleKey)),
          label: t("preauth.language"),
          description: descriptionKey ? t(descriptionKey) : "",
        },
      ];
    }),
  );
  const selected = pages[language];
  const options = SUPPORTED_LANGUAGES.map(({ code, label }) => `<option value="${code}"${code === language ? " selected" : ""}>${escapeHtml(label)}</option>`).join("");
  const body = `<main class="card"><label><span id="auth-language-label">${escapeHtml(selected.label)}</span><select id="auth-language">${options}</select></label><div id="auth-content">${selected.body}</div></main>
<script>
(() => {
  const pages = ${scriptJson(pages)};
  const select = document.getElementById("auth-language");
  select.addEventListener("change", () => {
    if (!Object.hasOwn(pages, select.value)) return;
    const name = document.querySelector('input[name="name"]')?.value;
    const page = pages[select.value];
    document.getElementById("auth-content").innerHTML = page.body;
    const input = document.querySelector('input[name="name"]');
    if (input && name !== undefined) input.value = name;
    document.getElementById("auth-language-label").textContent = page.label;
    document.documentElement.lang = select.value;
    document.title = page.title;
    for (const meta of document.querySelectorAll('meta[property="og:title"],meta[name="twitter:title"]')) meta.content = page.title;
    for (const meta of document.querySelectorAll('meta[property="og:description"],meta[name="twitter:description"]')) meta.content = page.description;
  });
})();
</script>`;
  return baseHtml(selected.title, body, descriptionKey ? { title: selected.title, description: selected.description } : undefined, PREAUTH_EXTRA_CSS, language);
}

export function nameInput(t: Translator["t"], name: string): string {
  return `<label>${escapeHtml(t("preauth.name"))} <input name="name" type="text" value="${escapeAttr(name)}" autofocus maxlength="64" required pattern="[\\p{L}\\p{N} ._'\\-]+" /></label>`;
}
