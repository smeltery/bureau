import type { CCPluginsState } from "../../../shared/types.ts";
import type { Translator } from "../../../shared/i18n/translate.ts";

export type PluginNotice = { installed: string } | { session: true };
export type PluginFailure = string | { fallback: true };
export type PluginAction = (key: string, fn: () => Promise<CCPluginsState>, notice?: PluginNotice) => Promise<boolean>;
class PluginResponseError extends Error {}

export async function pluginRequest(path: string, body?: Record<string, unknown>): Promise<CCPluginsState> {
  const response = await fetch(
    path,
    body === undefined
      ? undefined
      : {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        },
  );
  const data = await response.json();
  if (!response.ok) {
    if (typeof data?.error === "string" && data.error) throw new PluginResponseError(data.error);
    throw new Error("Plugin request failed");
  }
  return data;
}

export function pluginFailure(error: unknown): PluginFailure {
  return error instanceof PluginResponseError ? error.message : { fallback: true };
}

export function pluginFailureText(error: PluginFailure, t: Translator["t"]): string {
  return typeof error === "string" ? error : t("pluginsUi.actionFailed");
}
