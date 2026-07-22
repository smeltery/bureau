import { describe, expect, test } from "bun:test";
import { copyText, type ClipboardDocument } from "../clipboard.ts";

function fakeTextArea() {
  return {
    value: "",
    style: {} as CSSStyleDeclaration,
    selected: false,
    select() {
      this.selected = true;
    },
  } as HTMLTextAreaElement & { selected: boolean };
}

function fakeDocument(execResult = true): ClipboardDocument & {
  appended: HTMLTextAreaElement | null;
  removed: HTMLTextAreaElement | null;
} {
  const doc: ClipboardDocument & {
    appended: HTMLTextAreaElement | null;
    removed: HTMLTextAreaElement | null;
  } = {
    appended: null,
    removed: null,
    body: {
      appendChild(node) {
        doc.appended = node;
      },
      removeChild(node) {
        doc.removed = node;
      },
    },
    createElement(tagName) {
      expect(tagName).toBe("textarea");
      return fakeTextArea();
    },
    execCommand(command) {
      expect(command).toBe("copy");
      return execResult;
    },
  };
  return doc;
}

describe("copyText", () => {
  test("uses Clipboard API when available", async () => {
    const writes: string[] = [];
    const ok = await copyText("hello", {
      navigator: { clipboard: { writeText: async (text) => void writes.push(text) } },
    });

    expect(ok).toBe(true);
    expect(writes).toEqual(["hello"]);
  });

  test("falls back when Clipboard API is missing", async () => {
    const doc = fakeDocument();
    const ok = await copyText("fallback", { document: doc, navigator: {} });

    expect(ok).toBe(true);
    expect(doc.appended?.value).toBe("fallback");
    expect(doc.appended?.style.position).toBe("fixed");
    expect((doc.appended as HTMLTextAreaElement & { selected: boolean }).selected).toBe(true);
    expect(doc.removed).toBe(doc.appended);
  });

  test("falls back when Clipboard API rejects", async () => {
    const doc = fakeDocument();
    const ok = await copyText("blocked", {
      document: doc,
      navigator: { clipboard: { writeText: async () => Promise.reject(new Error("blocked")) } },
    });

    expect(ok).toBe(true);
    expect(doc.appended?.value).toBe("blocked");
  });

  test("reports failure when no copy path is available", async () => {
    await expect(copyText("nope", { navigator: {} })).resolves.toBe(false);
  });
});
