const WINDOW_MS = 60_000;
const MAX_PER_WINDOW = 30;
const MAX_TRACKED_IPS = 1024;

interface WindowCounter {
  start: number;
  count: number;
}

const windows = new Map<string, WindowCounter>();

export function allowReadyRequest(ip: string, now: number): boolean {
  const current = windows.get(ip);
  if (current && now - current.start < WINDOW_MS) {
    current.count += 1;
    return current.count <= MAX_PER_WINDOW;
  }

  if (!current && windows.size >= MAX_TRACKED_IPS) {
    for (const [key, window] of windows) {
      if (now - window.start >= WINDOW_MS) windows.delete(key);
    }
    if (windows.size >= MAX_TRACKED_IPS) return true;
  }

  windows.set(ip, { start: now, count: 1 });
  return true;
}

export function _testResetReadyLimiter(): void {
  windows.clear();
}
