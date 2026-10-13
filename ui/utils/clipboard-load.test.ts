import { expect, test } from "bun:test";
import { copyLoadedText } from "./clipboard-load.ts";

test("starts a promised clipboard write before the secret resolves", async () => {
  let resolve!: (text: string) => void;
  let data!: Promise<Blob>;
  let started = false;
  const pending = new Promise<string>((done) => {
    resolve = done;
  });
  const result = copyLoadedText(() => pending, {
    item: function (value: Record<string, Promise<Blob>>) {
      data = value["text/plain"]!;
      return { data };
    } as unknown as typeof ClipboardItem,
    write: async () => {
      started = true;
      expect(await (await data).text()).toBe("private value");
    },
  });
  expect(started).toBe(true);
  resolve("private value");
  expect(await result).toBe(true);
});

test("fallback reports failure and fetch errors remain visible", async () => {
  let loads = 0;
  expect(
    await copyLoadedText(
      async () => {
        loads++;
        return "private value";
      },
      {
        item: function (value: unknown) {
          return { value };
        } as unknown as typeof ClipboardItem,
        write: async () => {
          throw new Error("denied");
        },
        fallback: async () => false,
      },
    ),
  ).toBe(false);
  expect(loads).toBe(1);
  await expect(
    copyLoadedText(
      async () => {
        throw new Error("access revoked");
      },
      {
        item: function (value: unknown) {
          return { value };
        } as unknown as typeof ClipboardItem,
        write: async () => {
          throw new Error("denied");
        },
      },
    ),
  ).rejects.toThrow("access revoked");
});
