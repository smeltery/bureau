const KEY_DEVICE = "bureau-device";

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
