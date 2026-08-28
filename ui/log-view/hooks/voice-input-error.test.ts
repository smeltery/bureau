import { describe, expect, test } from "bun:test";

import { voiceInputErrorMessage } from "./voice-input-error.ts";

describe("voiceInputErrorMessage", () => {
  test("maps actionable browser errors to user-facing messages", () => {
    expect(voiceInputErrorMessage("not-allowed")).toContain("microphone permission");
    expect(voiceInputErrorMessage("service-not-allowed")).toContain("microphone permission");
    expect(voiceInputErrorMessage("audio-capture")).toBe("No microphone was found.");
    expect(voiceInputErrorMessage("network")).toContain("speech service");
  });

  test("suppresses non-actionable stop events and falls back for unknown codes", () => {
    expect(voiceInputErrorMessage("no-speech")).toBeNull();
    expect(voiceInputErrorMessage("aborted")).toBeNull();
    expect(voiceInputErrorMessage("not-a-real-speech-error")).toBe("Voice input failed.");
  });
});
