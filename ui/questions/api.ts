import type { PlainMessageKey, Translator } from "../../shared/i18n/translate.ts";

export type QuestionFailure = string | { key: PlainMessageKey };

class QuestionResponseError extends Error {}

// Only server-provided details are literal; transport and parsing failures use
// the caller's localized fallback without freezing the current display language.
export async function questionRequest(path: string, options?: RequestInit) {
  const response = await fetch(path, options);
  if (response.status === 204) return null;
  const body = await response.json();
  if (!response.ok) {
    if (typeof body.error === "string" && body.error) throw new QuestionResponseError(body.error);
    throw new Error("Question request failed");
  }
  return body;
}

export function questionFailure(error: unknown, fallback: PlainMessageKey): QuestionFailure {
  return error instanceof QuestionResponseError ? error.message : { key: fallback };
}

export function questionFailureText(error: QuestionFailure, t: Translator["t"]): string {
  return typeof error === "string" ? error : t(error.key);
}
