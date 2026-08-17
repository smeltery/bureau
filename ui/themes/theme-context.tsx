import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { type Features, PRODUCTION_FEATURES } from "../../shared/features.ts";
import { storageGetItem, storageSetItem } from "../browser-storage.ts";
import { DEFAULT_THEME_ID, getThemeById, THEMES, type Theme, type ThemeMode } from "./index.ts";

// Theme management — persisted to localStorage, applied via data-theme +
// data-theme-mode attributes on <html>. `theme` is the registered id;
// `mode` is the resolved 'dark'|'light' from the THEMES table and drives
// the handful of mode-dependent CSS rules (lamp glow, neon, diff2html).
interface ThemeContextValue {
  theme: string;
  mode: ThemeMode;
  setTheme: (id: string) => void;
  toggleTheme: () => void;
  cycleTheme: () => void;
}

const ThemeCtx = createContext<ThemeContextValue>({
  theme: DEFAULT_THEME_ID,
  mode: "dark",
  setTheme: () => {},
  toggleTheme: () => {},
  cycleTheme: () => {},
});

// Resolve the OS / browser color-scheme preference. Used as the default when
// the user hasn't picked a theme yet (and when they switch back to following
// system later, via the media-query listener below).
function getSystemThemeId(): string {
  if (typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia("(prefers-color-scheme: light)").matches) {
    return "light";
  }
  return DEFAULT_THEME_ID;
}

const USER_PICK_KEY = "bureau-theme";

function hasUserPickedTheme(): boolean {
  return storageGetItem(USER_PICK_KEY) != null;
}

function getInitialThemeId(): string {
  const saved = storageGetItem(USER_PICK_KEY);
  if (saved) {
    // If the stored id isn't a known theme, getThemeById falls back to
    // the default — return the canonical id so we don't keep round-
    // tripping the stale value.
    return getThemeById(saved).id;
  }
  // No explicit user choice: follow the OS preference.
  return getSystemThemeId();
}

const LAST_THEME_KEY = {
  dark: "bureau-theme-dark",
  light: "bureau-theme-light",
} as const;

// Remembers the most recent theme picked within each mode so the moon/sun
// toggle can return the user to their preferred Nord (dark) or Solarized
// Light (light) instead of always reverting to the canonical pair.
function getLastModeTheme(mode: ThemeMode): string {
  const saved = storageGetItem(LAST_THEME_KEY[mode]);
  if (saved) {
    const resolved = getThemeById(saved);
    if (resolved.mode === mode) return resolved.id;
  }
  return THEMES.find((t) => t.mode === mode)?.id ?? DEFAULT_THEME_ID;
}

export function nextThemeId(currentId: string): string {
  const cycleOrder = ["solarized-light", "light", "nord", "dracula", "solarized-dark", "dark"] as const;
  const current = getThemeById(currentId).id;
  const currentIndex = cycleOrder.findIndex((themeId) => themeId === current);
  return cycleOrder[(currentIndex + 1) % cycleOrder.length] ?? cycleOrder[0];
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [themeId, setThemeId] = useState<string>(getInitialThemeId);
  // Track whether the current theme came from an explicit user pick or from
  // the OS preference. While following the OS, we don't persist anything and
  // we live-react to `prefers-color-scheme` changes. Once the user picks a
  // theme (via ThemePicker or the moon/sun toggle), it sticks.
  const [userPicked, setUserPicked] = useState<boolean>(hasUserPickedTheme);
  const resolved: Theme = getThemeById(themeId);

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", resolved.id);
    document.documentElement.setAttribute("data-theme-mode", resolved.mode);
    if (userPicked) {
      storageSetItem(USER_PICK_KEY, resolved.id);
      storageSetItem(LAST_THEME_KEY[resolved.mode], resolved.id);
    }
    const color = resolved.vars["--bg-base"];
    let meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
    if (!meta) {
      meta = document.createElement("meta");
      meta.name = "theme-color";
      document.head.appendChild(meta);
    }
    meta.content = color;
  }, [resolved, userPicked]);

  // While we're following the OS preference (no explicit pick), swap the
  // theme live if the system flips between dark and light. Stops listening
  // once the user picks something explicit, since their choice should win.
  useEffect(() => {
    if (userPicked) return;
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mq = window.matchMedia("(prefers-color-scheme: light)");
    const onChange = () => setThemeId(getSystemThemeId());
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [userPicked]);

  // Cross-window sync. Fires when another window on the same origin writes
  // to our localStorage key — covers the landing's theme toggle updating
  // an embedded demo iframe (where the marketing site renders bureau), and
  // the reverse (clicking the wall moon inside the demo updates the
  // landing's palette).
  useEffect(() => {
    if (typeof window === "undefined") return;
    function onStorage(e: StorageEvent) {
      if (e.key !== USER_PICK_KEY && e.key !== null) return;
      if (e.newValue) {
        setUserPicked(true);
        setThemeId(getThemeById(e.newValue).id);
      } else {
        // Key was cleared in another window — go back to following the OS.
        setUserPicked(false);
        setThemeId(getSystemThemeId());
      }
    }
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const setTheme = useCallback((id: string) => {
    setUserPicked(true);
    setThemeId(getThemeById(id).id);
  }, []);

  // Kept for non-wall callers that want a simple dark/light handoff: jump to
  // the user's most recently picked theme in the opposite mode.
  const toggleTheme = useCallback(() => {
    setUserPicked(true);
    setThemeId((current) => {
      const currentMode = getThemeById(current).mode;
      const oppositeMode: ThemeMode = currentMode === "dark" ? "light" : "dark";
      return getLastModeTheme(oppositeMode);
    });
  }, []);

  const cycleTheme = useCallback(() => {
    setUserPicked(true);
    setThemeId((current) => nextThemeId(current));
  }, []);

  const value = useMemo(() => ({ theme: resolved.id, mode: resolved.mode, setTheme, toggleTheme, cycleTheme }), [resolved.id, resolved.mode, setTheme, toggleTheme, cycleTheme]);

  return <ThemeCtx.Provider value={value}>{children}</ThemeCtx.Provider>;
}

export function useTheme() {
  return useContext(ThemeCtx);
}

// Feature flags context — production defaults, demo overrides
const FeaturesCtx = createContext<Features>(PRODUCTION_FEATURES);

export function FeaturesProvider({ features, children }: { features: Features; children: ReactNode }) {
  return <FeaturesCtx.Provider value={features}>{children}</FeaturesCtx.Provider>;
}

export function useFeatures() {
  return useContext(FeaturesCtx);
}
