import type { PlainMessageKey, Translator } from "../../../../shared/i18n/translate.ts";
import type { LobbyLayoutId } from "../layouts.ts";

const layouts: Record<Exclude<LobbyLayoutId, "bureau">, PlainMessageKey> = {
  fireside: "settingsUi.editorFireside",
  lounge: "settingsUi.editorLounge",
  nook: "settingsUi.editorNook",
};
export function layoutLabel(id: LobbyLayoutId, t: Translator["t"]): string {
  return id === "bureau" ? "Bureau" : t(layouts[id]);
}
export function themeLabel(theme: { id: string; displayName: string }, t: Translator["t"]): string {
  if (theme.id === "dark") return t("settingsUi.editorDark");
  if (theme.id === "light") return t("settingsUi.editorLight");
  if (theme.id === "solarized-dark") return t("settingsUi.editorSolarizedDark");
  if (theme.id === "solarized-light") return t("settingsUi.editorSolarizedLight");
  return theme.displayName;
}
