const KEY_DEVICE = "bureau-device";
const KEY_SLIDE_MODE = "bureau-slide-mode";
const KEY_SLIDE_VIEW = "bureau-slide-view";
const KEY_SLIDE_POS = "bureau-slide-pos";

const slideModeListeners = new Set<() => void>();

export type SlidePos = { index: number; atEnd: boolean };

export function getDevice(): string | null {
  if (typeof localStorage === "undefined") return null;
  const value = localStorage.getItem(KEY_DEVICE);
  return value && value.trim() ? value : null;
}

export function setDevice(label: string | null): void {
  if (typeof localStorage === "undefined") return;
  const trimmed = label?.trim();
  if (trimmed) localStorage.setItem(KEY_DEVICE, trimmed);
  else localStorage.removeItem(KEY_DEVICE);
}

export function getSlideModeEnabled(): boolean {
  if (typeof localStorage === "undefined") return false;
  return localStorage.getItem(KEY_SLIDE_MODE) === "1";
}

export function setSlideModeEnabled(on: boolean): void {
  if (typeof localStorage === "undefined") return;
  const changed = getSlideModeEnabled() !== on;
  if (on) localStorage.setItem(KEY_SLIDE_MODE, "1");
  else localStorage.removeItem(KEY_SLIDE_MODE);
  if (!changed) return;
  for (const cb of slideModeListeners) cb();
}

export function subscribeSlideModeEnabled(cb: () => void): () => void {
  slideModeListeners.add(cb);
  const onStorage = (event: StorageEvent) => {
    if (event.key === null || event.key === KEY_SLIDE_MODE) cb();
  };
  if (typeof window !== "undefined") {
    window.addEventListener("storage", onStorage);
  }
  return () => {
    slideModeListeners.delete(cb);
    if (typeof window !== "undefined") {
      window.removeEventListener("storage", onStorage);
    }
  };
}

function readBoolMap(key: string): Record<string, boolean> {
  if (typeof localStorage === "undefined") return {};
  try {
    const raw = localStorage.getItem(key);
    const parsed = raw ? JSON.parse(raw) : null;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

export function getSlideView(agentId: string): boolean {
  return readBoolMap(KEY_SLIDE_VIEW)[agentId] === true;
}

export function setSlideView(agentId: string, on: boolean): void {
  if (typeof localStorage === "undefined") return;
  const map = readBoolMap(KEY_SLIDE_VIEW);
  if (on) map[agentId] = true;
  else delete map[agentId];
  localStorage.setItem(KEY_SLIDE_VIEW, JSON.stringify(map));
}

function readSlidePosMap(): Record<string, SlidePos> {
  if (typeof localStorage === "undefined") return {};
  try {
    const raw = localStorage.getItem(KEY_SLIDE_POS);
    const parsed = raw ? JSON.parse(raw) : null;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

export function getSlidePos(agentId: string): SlidePos | null {
  const value = readSlidePosMap()[agentId];
  if (!value || typeof value.index !== "number") return null;
  return { index: value.index, atEnd: value.atEnd === true };
}

export function setSlidePos(agentId: string, pos: SlidePos): void {
  if (typeof localStorage === "undefined") return;
  const map = readSlidePosMap();
  map[agentId] = { index: pos.index, atEnd: pos.atEnd };
  localStorage.setItem(KEY_SLIDE_POS, JSON.stringify(map));
}
