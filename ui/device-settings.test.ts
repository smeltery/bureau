import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  APP_PREVIEW_OPEN_TTL_MS,
  getAppPreviewOpenedAt,
  getAppPreviews,
  getDevice,
  getSlidePos,
  getSlideView,
  getUsagePin,
  markAppPreviewOpened,
  pruneAppPreviewOpens,
  setAppPreviews,
  setDevice,
  setSlidePos,
  setSlideView,
  setUsagePin,
} from "./device-settings.ts";

describe("device settings storage", () => {
  test("falls back when browser storage throws", () => {
    const originalDescriptor = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      get() {
        throw new Error("SecurityError");
      },
    });

    try {
      expect(getDevice()).toBeNull();
      expect(getSlideView("agent-1")).toBe(false);
      expect(getSlidePos("agent-1")).toBeNull();
      expect(() => setDevice("Laptop")).not.toThrow();
      expect(() => setSlideView("agent-1", true)).not.toThrow();
      expect(() => setSlidePos("agent-1", { index: 1, atEnd: false })).not.toThrow();
    } finally {
      if (originalDescriptor) Object.defineProperty(globalThis, "localStorage", originalDescriptor);
      else delete (globalThis as { localStorage?: unknown }).localStorage;
    }
  });
});

// The usage pill's pinned limit. Stored per device per agent AND per provider:
// an agent switched between engines must not stay pinned to a window the new
// provider doesn't have.
describe("usage pill pin", () => {
  const store = new Map<string, string>();
  let originalDescriptor: PropertyDescriptor | undefined;

  beforeEach(() => {
    store.clear();
    originalDescriptor = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      value: {
        get length() {
          return store.size;
        },
        getItem: (k: string) => store.get(k) ?? null,
        key: (i: number) => [...store.keys()][i] ?? null,
        removeItem: (k: string) => void store.delete(k),
        setItem: (k: string, v: string) => void store.set(k, v),
      },
    });
  });

  afterEach(() => {
    if (originalDescriptor) Object.defineProperty(globalThis, "localStorage", originalDescriptor);
    else delete (globalThis as { localStorage?: unknown }).localStorage;
  });

  const weekly = { label: "Weekly", index: 0 };
  const fiveHour = { label: "5-hour", index: 1 };

  test("defaults to auto (no pin)", () => {
    expect(getUsagePin("agent-1", "claude")).toBeNull();
  });

  test("round-trips a pinned window", () => {
    setUsagePin("agent-1", "claude", fiveHour);
    expect(getUsagePin("agent-1", "claude")).toEqual(fiveHour);
  });

  test("keeps agents and providers apart", () => {
    setUsagePin("agent-1", "claude", { label: "Weekly (Opus)", index: 2 });
    setUsagePin("agent-2", "claude", fiveHour);
    // Same agent, other engine: a Claude window label means nothing to Codex.
    expect(getUsagePin("agent-1", "codex")).toBeNull();
    expect(getUsagePin("agent-2", "claude")).toEqual(fiveHour);
    expect(getUsagePin("agent-1", "claude")).toEqual({ label: "Weekly (Opus)", index: 2 });
  });

  test("clears back to auto with null, leaving other pins alone", () => {
    setUsagePin("agent-1", "claude", fiveHour);
    setUsagePin("agent-2", "claude", weekly);
    setUsagePin("agent-1", "claude", null);
    expect(getUsagePin("agent-1", "claude")).toBeNull();
    expect(getUsagePin("agent-2", "claude")).toEqual(weekly);
  });

  test("survives a corrupt stored value instead of throwing", () => {
    store.set("bureau-usage-pin", "{not json");
    expect(getUsagePin("agent-1", "claude")).toBeNull();
    setUsagePin("agent-1", "claude", weekly);
    expect(getUsagePin("agent-1", "claude")).toEqual(weekly);
  });

  test("rejects a stored entry of the wrong shape rather than half-trusting it", () => {
    store.set("bureau-usage-pin", JSON.stringify({ "claude:agent-1": "Weekly", "claude:agent-2": { label: "Weekly" }, "claude:agent-3": { index: 1 } }));
    expect(getUsagePin("agent-1", "claude")).toBeNull();
    expect(getUsagePin("agent-2", "claude")).toBeNull();
    expect(getUsagePin("agent-3", "claude")).toBeNull();
  });
});

describe("app previews", () => {
  const store = new Map<string, string>();
  let originalDescriptor: PropertyDescriptor | undefined;

  beforeEach(() => {
    store.clear();
    originalDescriptor = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      value: {
        get length() {
          return store.size;
        },
        getItem: (k: string) => store.get(k) ?? null,
        key: (i: number) => [...store.keys()][i] ?? null,
        removeItem: (k: string) => void store.delete(k),
        setItem: (k: string, v: string) => void store.set(k, v),
      },
    });
  });

  afterEach(() => {
    if (originalDescriptor) Object.defineProperty(globalThis, "localStorage", originalDescriptor);
    else delete (globalThis as { localStorage?: unknown }).localStorage;
  });

  test("defaults on and round-trips this device's choice", () => {
    expect(getAppPreviews()).toBe(true);
    setAppPreviews(false);
    expect(getAppPreviews()).toBe(false);
    setAppPreviews(true);
    expect(getAppPreviews()).toBe(true);
  });

  test("remembers an exact app URL only for the app-session lifetime", () => {
    markAppPreviewOpened("https://habits.office.example", 1000);
    expect(getAppPreviewOpenedAt("https://habits.office.example", 1001)).toBe(1000);
    expect(getAppPreviewOpenedAt("https://other.office.example", 1001)).toBeNull();
    expect(getAppPreviewOpenedAt("https://habits.office.example", 1000 + APP_PREVIEW_OPEN_TTL_MS)).toBeNull();
  });

  test("prunes open facts for apps that are no longer listed", () => {
    markAppPreviewOpened("https://keep.office.example", 1000);
    markAppPreviewOpened("https://gone.office.example", 1000);
    pruneAppPreviewOpens(["https://keep.office.example"]);
    expect(getAppPreviewOpenedAt("https://keep.office.example", 1001)).toBe(1000);
    expect(getAppPreviewOpenedAt("https://gone.office.example", 1001)).toBeNull();
  });

  test("does not rewrite the open facts when every listed app remains", () => {
    const raw = '{ "https://keep.office.example": 1000 }';
    store.set("bureau-app-preview-opens", raw);
    pruneAppPreviewOpens(["https://keep.office.example"]);
    expect(store.get("bureau-app-preview-opens")).toBe(raw);
  });
});
