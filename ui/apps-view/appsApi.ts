import type { PlainMessageKey, Translator } from "../../shared/i18n/translate.ts";
// The browser side of /api/apps. The app registry is an HTTP surface (agents
// call the same routes), so the Apps tab talks to it directly rather than
// through the websocket — the deltas the server broadcasts are what keep every
// other open tab in step.

import type { AppListWire, AppLogsRes, AppWire } from "../../shared/apps.ts";
import type { AppVerb } from "./appVerbs.ts";

/**
 * The message a failed app route came back with. The routes answer
 * `{error: {code, message}}`, and the message is written for a human, so it is
 * shown as-is; anything else (a proxy's HTML, an empty body) falls back to the
 * status so the banner is never blank.
 */
function serverMessage(body: unknown): string | null {
  if (body && typeof body === "object") {
    const error = (body as { error?: unknown }).error;
    if (error && typeof error === "object") {
      const message = (error as { message?: unknown }).message;
      if (typeof message === "string" && message !== "") return message;
    }
  }
  return null;
}

export function appsErrorMessage(body: unknown, status: number): string {
  return serverMessage(body) ?? `HTTP ${status}`;
}
export type AppFailure = string | { key: PlainMessageKey } | { status: number };
export class AppUiError extends Error {
  readonly key: PlainMessageKey;
  constructor(key: PlainMessageKey) {
    super(key);
    this.key = key;
  }
}
class AppResponseError extends Error {
  readonly detail: string | null;
  constructor(
    body: unknown,
    readonly status: number,
  ) {
    super(appsErrorMessage(body, status));
    this.detail = serverMessage(body);
  }
}
export function appResponseError(body: unknown, status: number): Error {
  return new AppResponseError(body, status);
}
export function appFailure(error: unknown, fallback: PlainMessageKey): AppFailure {
  if (error instanceof AppResponseError) return error.detail ?? { status: error.status };
  return { key: error instanceof AppUiError ? error.key : fallback };
}
export function appFailureText(error: AppFailure, t: Translator["t"]): string {
  return typeof error === "string" ? error : "status" in error ? t("appsUi.httpError", { status: error.status }) : t(error.key);
}

export async function appsFetch<T>(method: string, path: string): Promise<T> {
  const res = await fetch(path, { method, credentials: "same-origin" });
  // 204 (delete) has no body at all, and neither does a proxy error page worth
  // parsing — a failed parse must not mask the status.
  const text = await res.text();
  let body: unknown = null;
  if (text !== "") {
    try {
      body = JSON.parse(text);
    } catch {
      if (res.ok) throw new Error("Invalid app response");
      body = null;
    }
  }
  if (!res.ok) throw appResponseError(body, res.status);
  if (res.status !== 204 && text === "") throw new Error("Empty app response");
  return body as T;
}

/** The visible apps. The route answers `{apps}`; callers want the list. */
export async function listApps(): Promise<AppListWire[]> {
  const body = await appsFetch<{ apps?: AppListWire[] }>("GET", "/api/apps?includeArchived=true");
  return body?.apps ?? [];
}

/**
 * start / stop / restart. Each answers with the app's FRESH wire object — the
 * same one that reaches every other open tab as a delta — so nothing here has
 * to re-fetch.
 */
export function controlApp(name: string, verb: AppVerb): Promise<AppWire> {
  return appsFetch<AppWire>("POST", `/api/apps/${encodeURIComponent(name)}/${verb}`);
}

export async function readAppLog(name: string): Promise<string[]> {
  const body = await appsFetch<AppLogsRes>("GET", `/api/apps/${encodeURIComponent(name)}/logs`);
  return body?.lines ?? [];
}

export async function deleteApp(name: string): Promise<void> {
  await appsFetch<null>("DELETE", `/api/apps/${encodeURIComponent(name)}`);
}
