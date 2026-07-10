export type SidePanel = "terminal" | "editor" | null;

const SIDE_PANEL_KEY = "bureau:side-panels";

export function readSidePanels(): Map<string, SidePanel> {
  if (typeof localStorage === "undefined") return new Map();
  try {
    const raw = localStorage.getItem(SIDE_PANEL_KEY);
    if (!raw) return new Map();
    const obj = JSON.parse(raw) as Record<string, SidePanel>;
    return new Map(Object.entries(obj));
  } catch {
    return new Map();
  }
}

export function writeSidePanels(map: Map<string, SidePanel>) {
  if (typeof localStorage === "undefined") return;
  try {
    const obj: Record<string, SidePanel> = {};
    map.forEach((v, k) => {
      if (v) obj[k] = v;
    });
    localStorage.setItem(SIDE_PANEL_KEY, JSON.stringify(obj));
  } catch {}
}
