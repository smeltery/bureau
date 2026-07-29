import { storageGetItem, storageReadObject, storageRemoveItem, storageSetItem } from "./browser-storage.ts";

const KEY_DEVICE = "bureau-device";
const KEY_SLIDE_MODE = "bureau-slide-mode";
const KEY_SLIDE_VIEW = "bureau-slide-view";
const KEY_SLIDE_POS = "bureau-slide-pos";

const slideModeListeners = new Set<() => void>();

export type SlidePos = { index: number; atEnd: boolean };

export function getDevice(): string | null {
  const value = storageGetItem(KEY_DEVICE);
  return value && value.trim() ? value : null;
}

export function setDevice(label: string | null): void {
  const trimmed = label?.trim();
  if (trimmed) storageSetItem(KEY_DEVICE, trimmed);
  else storageRemoveItem(KEY_DEVICE);
}

export function getSlideModeEnabled(): boolean {
  return storageGetItem(KEY_SLIDE_MODE) === "1";
}

export function setSlideModeEnabled(on: boolean): void {
  const changed = getSlideModeEnabled() !== on;
  if (on) storageSetItem(KEY_SLIDE_MODE, "1");
  else storageRemoveItem(KEY_SLIDE_MODE);
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
  return storageReadObject<Record<string, boolean>>(key) ?? {};
}

export function getSlideView(agentId: string): boolean {
  return readBoolMap(KEY_SLIDE_VIEW)[agentId] === true;
}

export function setSlideView(agentId: string, on: boolean): void {
  const map = readBoolMap(KEY_SLIDE_VIEW);
  if (on) map[agentId] = true;
  else delete map[agentId];
  storageSetItem(KEY_SLIDE_VIEW, JSON.stringify(map));
}

function readSlidePosMap(): Record<string, SlidePos> {
  return storageReadObject<Record<string, SlidePos>>(KEY_SLIDE_POS) ?? {};
}

export function getSlidePos(agentId: string): SlidePos | null {
  const value = readSlidePosMap()[agentId];
  if (!value || typeof value.index !== "number") return null;
  return { index: value.index, atEnd: value.atEnd === true };
}

export function setSlidePos(agentId: string, pos: SlidePos): void {
  const map = readSlidePosMap();
  map[agentId] = { index: pos.index, atEnd: pos.atEnd };
  storageSetItem(KEY_SLIDE_POS, JSON.stringify(map));
}
