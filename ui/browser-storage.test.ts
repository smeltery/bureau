import { describe, expect, test } from "bun:test";
import { getBrowserStorage, storageGetItem, storageReadObject, storageRemoveItem, storageSetItem, type BrowserStorage } from "./browser-storage.ts";

class ThrowingStorage implements BrowserStorage {
  get length(): number {
    throw new Error("SecurityError");
  }

  getItem(): string | null {
    throw new Error("SecurityError");
  }

  key(): string | null {
    throw new Error("SecurityError");
  }

  removeItem() {
    throw new Error("SecurityError");
  }

  setItem() {
    throw new Error("SecurityError");
  }
}

describe("browser storage adapter", () => {
  test("treats inaccessible browser storage as unavailable", () => {
    const originalDescriptor = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      get() {
        throw new Error("SecurityError");
      },
    });

    try {
      expect(getBrowserStorage()).toBeNull();
    } finally {
      if (originalDescriptor) Object.defineProperty(globalThis, "localStorage", originalDescriptor);
      else delete (globalThis as { localStorage?: unknown }).localStorage;
    }
  });

  test("turns storage operation failures into no-ops or null reads", () => {
    const storage = new ThrowingStorage();

    expect(storageGetItem("key", storage)).toBeNull();
    expect(storageReadObject("key", storage)).toBeNull();
    expect(() => storageSetItem("key", "value", storage)).not.toThrow();
    expect(() => storageRemoveItem("key", storage)).not.toThrow();
  });

  test("parses stored objects and rejects malformed values", () => {
    const values = new Map<string, string>([
      ["object", '{"enabled":true}'],
      ["array", "[1]"],
      ["bad", "{"],
    ]);
    const storage: BrowserStorage = {
      length: values.size,
      getItem: (key) => values.get(key) ?? null,
      key: (index) => Array.from(values.keys())[index] ?? null,
      removeItem: (key) => values.delete(key),
      setItem: (key, value) => values.set(key, value),
    };

    expect(storageReadObject("object", storage)).toEqual({ enabled: true });
    expect(storageReadObject("array", storage)).toBeNull();
    expect(storageReadObject("bad", storage)).toBeNull();
  });
});
