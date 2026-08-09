// The browser side of /api/apps. The app registry is an HTTP surface (agents
// call the same routes), so the Apps tab talks to it directly rather than
// through the websocket — the deltas the server broadcasts are what keep every
// other open tab in step.

import type { AppLogsRes, AppWire } from "../../shared/apps.ts";
import type { AppVerb } from "./appVerbs.ts";

/**
 * The message a failed app route came back with. The routes answer
 * `{error: {code, message}}`, and the message is written for a human, so it is
 * shown as-is; anything else (a proxy's HTML, an empty body) falls back to the
 * status so the banner is never blank.
 */
export function appsErrorMessage(body: unknown, status: number): string {
  if (body && typeof body === "object") {
    const error = (body as { error?: unknown }).error;
    if (error && typeof error === "object") {
      const message = (error as { message?: unknown }).message;
      if (typeof message === "string" && message !== "") return message;
    }
  }
  return `HTTP ${status}`;
}

async function appsFetch<T>(method: string, path: string): Promise<T> {
  const res = await fetch(path, { method, credentials: "same-origin" });
  // 204 (delete) has no body at all, and neither does a proxy error page worth
  // parsing — a failed parse must not mask the status.
  const text = await res.text();
  let body: unknown = null;
  if (text !== "") {
    try {
      body = JSON.parse(text);
    } catch {
      body = null;
    }
  }
  if (!res.ok) throw new Error(appsErrorMessage(body, res.status));
  return body as T;
}

/** The visible apps. The route answers `{apps}`; callers want the list. */
export async function listApps(): Promise<AppWire[]> {
  const body = await appsFetch<{ apps?: AppWire[] }>("GET", "/api/apps");
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
