import { describe, expect, test } from "bun:test";
import { APP_PREVIEW_OPEN_TTL_MS } from "../device-settings.ts";
import { appCanPreview, appPreviewPhase } from "./appPreview.ts";

describe("appCanPreview", () => {
  test("previews a running app at an office-issued origin", () => {
    expect(appCanPreview({ state: "running", url: "https://habits.office.example" })).toBe(true);
  });

  test("does not frame plain-port fallbacks from a potentially HTTPS office", () => {
    expect(appCanPreview({ state: "running" })).toBe(false);
    expect(appCanPreview({ state: "running", url: "" })).toBe(false);
  });

  test("does not wake or contact an app that is not running", () => {
    for (const state of ["starting", "stopped", "failed", "unknown"] as const) {
      expect(appCanPreview({ state, url: "https://habits.office.example" })).toBe(false);
    }
  });
});

describe("appPreviewPhase", () => {
  test("prompts until this device has opened the exact app URL", () => {
    expect(appPreviewPhase(null, 1000, true, false)).toBe("open-prompt");
  });

  test("loads while offscreen or while the opened app has focus", () => {
    expect(appPreviewPhase(1000, 1001, false, false)).toBe("loading");
    expect(appPreviewPhase(1000, 1001, true, true)).toBe("loading");
  });

  test("frames a recently opened app after the browser returns", () => {
    expect(appPreviewPhase(1000, 1001, true, false)).toBe("frame");
  });

  test("prompts again when the app session lifetime has elapsed", () => {
    expect(appPreviewPhase(1000, 1000 + APP_PREVIEW_OPEN_TTL_MS, true, false)).toBe("open-prompt");
  });

  test("prompts instead of framing when live previews are disabled", () => {
    expect(appPreviewPhase(1000, 1001, true, false, false)).toBe("open-prompt");
  });
});
