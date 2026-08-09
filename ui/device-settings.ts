import { storageGetItem, storageReadObject, storageRemoveItem, storageSetItem } from "./browser-storage.ts";

const KEY_DEVICE = "bureau-device";
const KEY_SLIDE_VIEW = "bureau-slide-view";
const KEY_SLIDE_POS = "bureau-slide-pos";

// Which plan-allowance limit the usage pill's number tracks, per device per
// agent. The pill defaults to the most constrained window; pinning overrides
// that for people who care about one specific limit. Stored as one JSON object
// { [provider:agentId]: { label, index } }.
//
// Both halves are needed. The INDEX identifies the exact row that was clicked,
// which matters because window labels are NOT guaranteed unique (two Codex
// windows of equal duration render the same label; a server-supplied Claude
// model_scoped name can collide with a fixed one). The LABEL is what keeps the
// pin meaningful when the provider reorders its windows. resolveTrackedWindow
// in ui/log-view/components/subscription-pill-view.ts spells out how the two
// are combined.
//
// The key includes the PROVIDER, not just the agent, so switching an agent
// between engines can't leave it pinned to a window the new provider doesn't
// have — Claude's "Weekly (Opus)" means nothing to Codex. A pin whose window is
// simply absent from the current reading falls back to auto anyway, so this is
// belt and braces.
const KEY_USAGE_PIN = "bureau-usage-pin";

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

export type UsagePin = { label: string; index: number };

function usagePinKey(agentId: string, provider: string): string {
  return `${provider}:${agentId}`;
}

function readUsagePinMap(): Record<string, UsagePin> {
  return storageReadObject<Record<string, UsagePin>>(KEY_USAGE_PIN) ?? {};
}

export function getUsagePin(agentId: string, provider: string): UsagePin | null {
  const v = readUsagePinMap()[usagePinKey(agentId, provider)];
  if (!v || typeof v !== "object") return null;
  if (typeof v.label !== "string" || v.label.length === 0) return null;
  if (typeof v.index !== "number" || !Number.isFinite(v.index)) return null;
  return { label: v.label, index: v.index };
}

// `pin` null clears the pin, i.e. back to auto.
export function setUsagePin(agentId: string, provider: string, pin: UsagePin | null): void {
  const map = readUsagePinMap();
  if (pin === null) delete map[usagePinKey(agentId, provider)];
  else map[usagePinKey(agentId, provider)] = pin;
  storageSetItem(KEY_USAGE_PIN, JSON.stringify(map));
}
