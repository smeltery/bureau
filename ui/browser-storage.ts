export interface BrowserStorage {
  readonly length: number;
  getItem(key: string): string | null;
  key(index: number): string | null;
  removeItem(key: string): void;
  setItem(key: string, value: string): void;
}

export function getBrowserStorage(): BrowserStorage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

export function storageGetItem(key: string, storage: BrowserStorage | null = getBrowserStorage()): string | null {
  if (!storage) return null;
  try {
    return storage.getItem(key);
  } catch {
    return null;
  }
}

export function storageSetItem(key: string, value: string, storage: BrowserStorage | null = getBrowserStorage()): void {
  if (!storage) return;
  try {
    storage.setItem(key, value);
  } catch {}
}

export function storageRemoveItem(key: string, storage: BrowserStorage | null = getBrowserStorage()): void {
  if (!storage) return;
  try {
    storage.removeItem(key);
  } catch {}
}

export function storageReadObject<T extends Record<string, unknown>>(key: string, storage: BrowserStorage | null = getBrowserStorage()): T | null {
  const raw = storageGetItem(key, storage);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as T) : null;
  } catch {
    return null;
  }
}
