import { describe, expect, test } from "bun:test";
import { completedSlashCommandDraft, isSendNowShortcut } from "./InputComposerField.tsx";

describe("isSendNowShortcut", () => {
  test("accepts Ctrl+Enter and Cmd+Enter on desktop", () => {
    expect(isSendNowShortcut({ key: "Enter", ctrlKey: true, metaKey: false, shiftKey: false }, false)).toBe(true);
    expect(isSendNowShortcut({ key: "Enter", ctrlKey: false, metaKey: true, shiftKey: false }, false)).toBe(true);
  });

  test("ignores shifted, mobile, and non-enter events", () => {
    expect(isSendNowShortcut({ key: "Enter", ctrlKey: true, metaKey: false, shiftKey: true }, false)).toBe(false);
    expect(isSendNowShortcut({ key: "Enter", ctrlKey: true, metaKey: false, shiftKey: false }, true)).toBe(false);
    expect(isSendNowShortcut({ key: "c", ctrlKey: true, metaKey: false, shiftKey: false }, false)).toBe(false);
  });
});

describe("completedSlashCommandDraft", () => {
  test("adds a command space for a bare slash token", () => {
    expect(completedSlashCommandDraft("/ver", "verify")).toEqual({ text: "/verify ", caret: 8 });
  });

  test("preserves trailing text and places the caret before it", () => {
    expect(completedSlashCommandDraft("/ver  keep this\n\tand this /other", "verify")).toEqual({
      text: "/verify  keep this\n\tand this /other",
      caret: 7,
    });
  });
});
