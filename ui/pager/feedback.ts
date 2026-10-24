import type { PagerDeliveryFailure } from "../../shared/user-types.ts";
import type { PlainMessageKey, Translator } from "../../shared/i18n/translate.ts";

const FAILURE_KEYS: Record<PagerDeliveryFailure, PlainMessageKey> = {
  no_webhook: "pager.failure.noWebhook",
  http_4xx: "pager.failure.rejected",
  http_5xx: "pager.failure.server",
  rate_limited: "pager.failure.rateLimited",
  network: "pager.failure.network",
};

export function deliveryFailureText(failure: string | number, t: Translator["t"], retrying = false): string {
  const reason = Object.hasOwn(FAILURE_KEYS, failure) ? t(FAILURE_KEYS[failure as PagerDeliveryFailure]) : String(failure);
  return retrying && (failure === "http_5xx" || failure === "rate_limited" || failure === "network") ? t("pager.retrying", { reason }) : reason;
}

export type PagerFailure = string | { key: PlainMessageKey } | { failure: string | number };

class PagerResponseError extends Error {}
class PagerDeliveryError extends Error {
  constructor(readonly failure: string | number) {
    super("Pager delivery failed");
  }
}

export async function pagerRequest<T = unknown>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(path, options);
  if (response.status === 204) return undefined as T;
  const body = await response.json();
  if (!response.ok) {
    if (typeof body.error === "string" && body.error) throw new PagerResponseError(body.error);
    if (typeof body.failure === "string") throw new PagerDeliveryError(body.failure);
    throw new Error("Pager request failed");
  }
  return body as T;
}

export function pagerFailure(error: unknown, fallback: PlainMessageKey): PagerFailure {
  if (error instanceof PagerResponseError) return error.message;
  if (error instanceof PagerDeliveryError) return { failure: error.failure };
  return { key: fallback };
}

export function pagerFailureText(error: PagerFailure, t: Translator["t"]): string {
  if (typeof error === "string") return error;
  return "key" in error ? t(error.key) : t("pager.settings.testFailed", { reason: deliveryFailureText(error.failure, t) });
}

export function pageAge(timestamp: number, language: string, now = Date.now()): string {
  const minutes = Math.max(0, Math.round((now - timestamp) / 60_000));
  const hours = Math.round(minutes / 60);
  const [value, unit] = minutes < 60 ? ([minutes, "minute"] as const) : hours < 48 ? ([hours, "hour"] as const) : ([Math.round(hours / 24), "day"] as const);
  return new Intl.RelativeTimeFormat(language).format(-value, unit);
}
