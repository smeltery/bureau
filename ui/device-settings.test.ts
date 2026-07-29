import { describe, expect, test } from "bun:test";
import { getDevice, getSlideModeEnabled, getSlidePos, getSlideView, setDevice, setSlideModeEnabled, setSlidePos, setSlideView } from "./device-settings.ts";

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
      expect(getSlideModeEnabled()).toBe(false);
      expect(getSlideView("agent-1")).toBe(false);
      expect(getSlidePos("agent-1")).toBeNull();
      expect(() => setDevice("Laptop")).not.toThrow();
      expect(() => setSlideModeEnabled(true)).not.toThrow();
      expect(() => setSlideView("agent-1", true)).not.toThrow();
      expect(() => setSlidePos("agent-1", { index: 1, atEnd: false })).not.toThrow();
    } finally {
      if (originalDescriptor) Object.defineProperty(globalThis, "localStorage", originalDescriptor);
      else delete (globalThis as { localStorage?: unknown }).localStorage;
    }
  });
});
