import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "fs";
import { join } from "path";

import { BUREAU_DIR } from "./persistence.ts";
import { formatAttachmentLines, quoteOneLine, resolveAttachmentNotices, stripAttachmentNotices } from "./attachment-prompt.ts";
import { stripPluginPrefix } from "./plugins/plugin-prefix.ts";

const TEST_AGENT_ID = `test-attachment-prompt-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const FILES_DIR = join(BUREAU_DIR, "logs", TEST_AGENT_ID, "files");

function fixtureFile(filename: string, contents: Buffer | string) {
  mkdirSync(FILES_DIR, { recursive: true });
  writeFileSync(join(FILES_DIR, filename), contents);
}

function spec(filename: string, mediaType = "text/plain", size = 1) {
  return { filename, originalName: filename, mediaType, size };
}

afterAll(() => {
  rmSync(join(BUREAU_DIR, "logs", TEST_AGENT_ID), { recursive: true, force: true });
});

describe("resolveAttachmentNotices", () => {
  test("resolves existing attachment specs to path notices", () => {
    fixtureFile("a.txt", "hello");
    expect(
      resolveAttachmentNotices(TEST_AGENT_ID, [
        {
          filename: "a.txt",
          originalName: "original.txt",
          mediaType: "text/plain",
          size: 5,
        },
      ]),
    ).toEqual([
      {
        originalName: "original.txt",
        mediaType: "text/plain",
        size: 5,
        path: join(FILES_DIR, "a.txt"),
      },
    ]);
  });

  test("skips missing files without placeholders and preserves order", () => {
    fixtureFile("one.png", Buffer.from([1]));
    fixtureFile("three.pdf", Buffer.from([3]));
    const notices = resolveAttachmentNotices(TEST_AGENT_ID, [spec("one.png", "image/png"), spec("missing.txt"), spec("three.pdf", "application/pdf")]);
    expect(notices.map((notice) => notice.originalName)).toEqual(["one.png", "three.pdf"]);
  });
});

describe("formatAttachmentLines", () => {
  test("formats one one-line notice per attachment", () => {
    const lines = formatAttachmentLines([
      {
        originalName: "photo.png",
        mediaType: "image/png",
        size: 2048,
        path: "/state/logs/agent/files/photo.png",
      },
    ]);
    expect(lines).toEqual(['[Attachment: "photo.png" (image/png, 2 KB) saved at "/state/logs/agent/files/photo.png". If your reply depends on it, open it before answering about its contents.]']);
  });

  test("escapes hostile names and malformed media types", () => {
    const [line] = formatAttachmentLines([
      {
        originalName: 'evil"name\nwith \\ tricks\tand \u2028break',
        mediaType: 'image/png\n(fake) "quote"',
        size: 1,
        path: "/tmp/file",
      },
    ]);
    expect(line).not.toContain("\n");
    expect(line).not.toContain("\t");
    expect(line).not.toContain("\u2028");
    expect(line).toContain('\\"name');
    expect(line).toContain("\\n");
    expect(line).toContain("image/png__fake_ _quote_");
  });
});

describe("quoteOneLine", () => {
  test("round-trips ordinary JSON strings", () => {
    expect(JSON.parse(quoteOneLine("hello world"))).toBe("hello world");
  });
});

describe("stripAttachmentNotices", () => {
  const NOTICE =
    '[Attachment: "image.png" (image/png, 527.0 KB) saved at ' + '"/home/nil/.bureau/logs/agent-1/files/image_7.png". ' + "If your reply depends on it, open it before answering about its contents.]";

  test("leaves text without a notice block untouched", () => {
    expect(stripAttachmentNotices("[Nil] hello world")).toBe("[Nil] hello world");
    expect(stripAttachmentNotices("")).toBe("");
  });

  test("strips a notice glued straight onto the user text", () => {
    const userText = "[Nil (Windows)] Here is the screenshot of the cutoff slide.";
    expect(stripAttachmentNotices(userText + NOTICE)).toBe(userText);
  });

  test("strips a multi-attachment block joined by newlines", () => {
    const second = '[Attachment: "notes.md" (text/plain, 2.0 KB) saved at "/tmp/notes.md". ' + "If your reply depends on it, open it before answering about its contents.]";
    expect(stripAttachmentNotices("[Nil] two files" + NOTICE + "\n" + second)).toBe("[Nil] two files");
  });

  test("matches the block the formatter actually produces", () => {
    fixtureFile("strip-me.txt", "x");
    const lines = formatAttachmentLines(resolveAttachmentNotices(TEST_AGENT_ID, [spec("strip-me.txt")]));
    expect(stripAttachmentNotices("[Nil] here" + lines.join("\n"))).toBe("[Nil] here");
  });

  test("preserves the user's own trailing newline", () => {
    expect(stripAttachmentNotices("[Nil] trailing\n" + NOTICE)).toBe("[Nil] trailing\n");
  });

  test("only strips at the end, never mid-message", () => {
    const text = "[Nil] see " + NOTICE + " and then some more words";
    expect(stripAttachmentNotices(text)).toBe(text);
  });

  test("composes with stripPluginPrefix to recover the bare sdkText", () => {
    const sdkText = "[Nil] both at once";
    const recorded = "--- begin plugin: mem0 ---\n" + "prior note\n" + "--- end plugin: mem0 ---\n\n" + "User message:\n" + sdkText + NOTICE;
    expect(stripAttachmentNotices(stripPluginPrefix(recorded))).toBe(sdkText);
  });
});
