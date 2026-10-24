import { detectBrowserLanguage, isSupportedLanguage, type SupportedLanguageCode } from "../../../shared/languages.ts";
import { getUserById } from "../../users.ts";
import { readSessionCookie, validateSession } from "../auth.ts";

export function authLanguage(req?: Request, submitted?: FormDataEntryValue | null): SupportedLanguageCode {
  if (isSupportedLanguage(submitted)) return submitted;
  if (!req) return "en";
  const session = validateSession(readSessionCookie(req));
  const saved = session ? getUserById(session.userId)?.language : null;
  if (saved) return saved;
  const choices = (req.headers.get("accept-language") ?? "").split(",").map((part, index) => {
    const [tag, ...parameters] = part.trim().split(";");
    const quality = parameters.find((parameter) => parameter.trim().startsWith("q="));
    const weight = quality === undefined ? 1 : Number(quality.trim().slice(2));
    return { language: detectBrowserLanguage(tag), weight, index };
  });
  return choices.filter(({ language, weight }) => language && Number.isFinite(weight) && weight > 0 && weight <= 1).sort((a, b) => b.weight - a.weight || a.index - b.index)[0]?.language ?? "en";
}
