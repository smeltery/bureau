import type { AppRecord } from "../../shared/apps.ts";
import { capturePreview, type PreviewFailure } from "../preview-capture.ts";

export const APP_PREVIEW_CACHE_TTL_MS = 4 * 60 * 60 * 1000;
export const APP_PREVIEW_VIEWPORT = { width: 800, height: 500 } as const;

type CachedPreview = { png: Buffer; expiresAt: number };
export type AppPreviewResult = { ok: true; png: Buffer } | PreviewFailure;

export function createAppPreviewCapture(capture: typeof capturePreview = capturePreview, now: () => number = Date.now) {
  const cache = new Map<string, CachedPreview>();
  const inFlight = new Map<string, Promise<AppPreviewResult>>();
  const keyOf = (app: AppRecord) => `${app.name}:${app.hostLabel}:${app.hostGen}`;

  return {
    async capture(app: AppRecord): Promise<AppPreviewResult> {
      const key = keyOf(app);
      const cached = cache.get(key);
      if (cached && cached.expiresAt > now()) return { ok: true, png: cached.png };
      if (cached) cache.delete(key);

      const existing = inFlight.get(key);
      if (existing) return existing;
      if (inFlight.size >= 1) {
        return { ok: false, status: 429, code: "capture_busy", error: "another app preview is being captured" };
      }

      const pending: Promise<AppPreviewResult> = capture({
        url: `http://127.0.0.1:${app.port}/`,
        viewport: APP_PREVIEW_VIEWPORT,
        wait: 0,
      }).then((result) => {
        if (!result.ok) return result;
        cache.set(key, { png: result.png, expiresAt: now() + APP_PREVIEW_CACHE_TTL_MS });
        return { ok: true, png: result.png };
      });

      inFlight.set(key, pending);
      try {
        return await pending;
      } finally {
        if (inFlight.get(key) === pending) inFlight.delete(key);
      }
    },

    invalidate(name: string): void {
      for (const key of cache.keys()) {
        if (key.startsWith(`${name}:`)) cache.delete(key);
      }
    },
  };
}

export const appPreviewCapture = createAppPreviewCapture();
