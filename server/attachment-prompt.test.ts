import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "fs";
import { join } from "path";

import { BUREAU_DIR } from "./persistence.ts";
import { formatAttachmentLines, formatSize, quoteOneLine, resolveAttachmentNotices } from "./attachment-prompt.ts";

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
    expect(lines).toEqual(['[Attachment: "photo.png" (image/png, 2.0 KB) saved at "/state/logs/agent/files/photo.png". If your reply depends on it, open it before answering about its contents.]']);
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

describe("formatSize", () => {
  test("formats deterministic binary sizes", () => {
    expect(formatSize(0)).toBe("0 B");
    expect(formatSize(1023)).toBe("1023 B");
    expect(formatSize(1024)).toBe("1.0 KB");
    expect(formatSize(1024 * 1024)).toBe("1.0 MB");
    expect(formatSize(Number.NaN)).toBe("unknown size");
  });
});

describe("quoteOneLine", () => {
  test("round-trips ordinary JSON strings", () => {
    expect(JSON.parse(quoteOneLine("hello world"))).toBe("hello world");
  });
});
