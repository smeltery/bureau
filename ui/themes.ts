// Theme registry. Each theme is a `data-theme="<id>"` attribute value on
// <html>, plus a `data-theme-mode` ('dark'|'light') for the few CSS rules
// that must branch on mode rather than on a specific theme (lamp glow,
// window day/night, neon sign, diff2html palette).
//
// All ~73 CSS variables are defined per theme. Existing Dark and Light
// values are byte-for-byte preserved from the original styles.ts. New
// themes (Nord, Dracula, Solarized Dark/Light) supply the same shape;
// office-scene props are picked to fit each palette rather than hand-tuned
// pixel-by-pixel.

import { DARK_VARS, LIGHT_VARS, type ThemeVars } from "./theme-base-vars.ts";
import { DRACULA_VARS, NORD_VARS, SOLARIZED_DARK_VARS, SOLARIZED_LIGHT_VARS } from "./theme-custom-vars.ts";

export type ThemeMode = "dark" | "light";

export interface Theme {
  id: string;
  displayName: string;
  mode: ThemeMode;
  vars: ThemeVars;
}

export const THEMES: readonly Theme[] = [
  { id: "dark", displayName: "Dark", mode: "dark", vars: DARK_VARS },
  { id: "light", displayName: "Light", mode: "light", vars: LIGHT_VARS },
  { id: "nord", displayName: "Nord", mode: "dark", vars: NORD_VARS },
  { id: "dracula", displayName: "Dracula", mode: "dark", vars: DRACULA_VARS },
  { id: "solarized-dark", displayName: "Solarized Dark", mode: "dark", vars: SOLARIZED_DARK_VARS },
  { id: "solarized-light", displayName: "Solarized Light", mode: "light", vars: SOLARIZED_LIGHT_VARS },
];

export const DEFAULT_THEME_ID = "dark";

export function getThemeById(id: string): Theme {
  return THEMES.find((t) => t.id === id) ?? THEMES.find((t) => t.id === DEFAULT_THEME_ID)!;
}

// Emit the per-theme CSS blocks. The first (Dark) doubles as `:root` so the
// page renders correctly before any `data-theme` attribute is applied.
export function emitThemesCss(): string {
  return THEMES.map((theme, index) => {
    const selector = index === 0 ? `:root, [data-theme="${theme.id}"]` : `[data-theme="${theme.id}"]`;
    const declarations = Object.entries(theme.vars)
      .map(([name, value]) => `    ${name}: ${value};`)
      .join("\n");
    return `  /* Theme: ${theme.displayName} */\n  ${selector} {\n${declarations}\n    color-scheme: ${theme.mode};\n  }`;
  }).join("\n\n");
}
