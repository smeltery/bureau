import type { PlainMessageKey, Translator } from "../../../../shared/i18n/translate.ts";

export type WebhookFailure = string | { key: PlainMessageKey };
export class WebhookUiError extends Error {
  readonly key: PlainMessageKey;
  constructor(key: PlainMessageKey) {
    super(key);
    this.key = key;
  }
}
class WebhookResponseError extends Error {}
export async function webhookRequest(path: string, method = "GET", body?: unknown) {
  const response = await fetch(path, { method, headers: { "Content-Type": "application/json" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const data = response.status === 204 ? null : await response.json();
  if (!response.ok) {
    if (typeof data?.error === "string" && data.error) throw new WebhookResponseError(data.error);
    throw new WebhookUiError("webhooks.requestFailed");
  }
  return data;
}
export function webhookFailure(error: unknown): WebhookFailure {
  return error instanceof WebhookResponseError ? error.message : { key: error instanceof WebhookUiError ? error.key : "webhooks.requestFailed" };
}
export function webhookFailureText(error: WebhookFailure, t: Translator["t"]): string {
  return typeof error === "string" ? error : t(error.key);
}
export function parseWebhookPayload(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    throw new WebhookUiError("webhooks.invalidJson");
  }
}
