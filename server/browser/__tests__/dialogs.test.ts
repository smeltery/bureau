import { expect, test } from "bun:test";
import type { Page, Dialog } from "playwright-core";
import { BrowserDialogs } from "../dialogs.ts";

test("only the first action dialog is accepted and rejected closes do not escape", async () => {
  let listener!: (dialog: Dialog) => void;
  const policy = new BrowserDialogs();
  policy.watch({
    on: (_event: string, fn: typeof listener) => {
      listener = fn;
    },
  } as unknown as Page);
  const calls: boolean[] = [];
  const open = (reject = false) =>
    listener({
      type: () => "confirm",
      message: () => "Proceed?",
      accept: async () => {
        calls.push(true);
        if (reject) throw new Error("page closed");
      },
      dismiss: async () => {
        calls.push(false);
        if (reject) throw new Error("page closed");
      },
    } as unknown as Dialog);
  const finish = policy.begin("accept");
  open();
  open();
  await Bun.sleep(0);
  expect(finish({ ok: true, url: "http://local", title: "Page" }).dialogs?.map((d) => d.accepted)).toEqual([true, false]);
  open(true);
  await Bun.sleep(0);
  expect(calls).toEqual([true, false, false]);
  const failed = policy.begin("accept");
  open(true);
  await Bun.sleep(0);
  expect(failed({ ok: false, status: 500, code: "action_failed", error: "closed" }).dialogs?.[0].accepted).toBe(false);
});
