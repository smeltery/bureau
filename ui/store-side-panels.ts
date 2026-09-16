import { storageReadObject, storageSetItem } from "./browser-storage.ts";

export type SidePanel = "terminal" | "editor" | "browser" | null;

// "browser" is the experimental agent-browser panel
// (office setting experimental.browserPanel): live CDP frames + manager copy/drag.

const SIDE_PANEL_KEY = "bureau:side-panels";

export function readSidePanels(): Map<string, SidePanel> {
  const obj = storageReadObject<Record<string, SidePanel>>(SIDE_PANEL_KEY);
  return obj ? new Map(Object.entries(obj)) : new Map();
}

export function writeSidePanels(map: Map<string, SidePanel>) {
  const obj: Record<string, SidePanel> = {};
  map.forEach((v, k) => {
    if (v) obj[k] = v;
  });
  storageSetItem(SIDE_PANEL_KEY, JSON.stringify(obj));
}
