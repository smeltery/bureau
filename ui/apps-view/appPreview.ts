import type { AppWire } from "../../shared/apps.ts";
import { APP_PREVIEW_OPEN_TTL_MS } from "../device-settings.ts";

export const BACKGROUND_OPEN_FALLBACK_MS = 1500;

export function appCanPreview(app: Pick<AppWire, "url" | "state">): boolean {
  return app.state === "running" && typeof app.url === "string" && app.url !== "";
}

export type AppPreviewPhase = "open-prompt" | "loading" | "frame";

export function appPreviewPhase(openedAt: number | null, now: number, visible: boolean, waitingForReturn: boolean, framesAllowed = true): AppPreviewPhase {
  if (!framesAllowed) return "open-prompt";
  if (openedAt === null || now - openedAt >= APP_PREVIEW_OPEN_TTL_MS) return "open-prompt";
  if (!visible || waitingForReturn) return "loading";
  return "frame";
}
