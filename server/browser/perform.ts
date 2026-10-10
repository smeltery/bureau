import type { Page } from "playwright-core";
import { describeShot, type BrowserSuccess, type ParsedParams } from "./params.ts";
import { readBrowserSnapshot, readBrowserText, resolveBrowserFrame } from "./frames.ts";

export const MAX_SNAPSHOT_CHARS = 20_000;

export class NoPageError extends Error {
  constructor() {
    super("no page is open; call the goto action first");
  }
}

function cap(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, max)}\n[truncated at ${max} characters]`;
}

export async function performBrowserAction(page: Page, params: ParsedParams, timeout: number, markOpened: () => void): Promise<BrowserSuccess> {
  const target = params.framePath ? resolveBrowserFrame(page.mainFrame(), params.framePath) : page;
  switch (params.action) {
    case "goto":
      await page.goto(params.url!.toString(), { waitUntil: "load", timeout });
      markOpened();
      break;
    case "click":
      await target.click(params.selector!, { timeout, noWaitAfter: true });
      await new Promise((resolve) => setTimeout(resolve, Math.min(100, timeout)));
      break;
    case "select": {
      await target.$eval(
        params.selector!,
        (node, choice) => {
          if (!(node instanceof HTMLSelectElement) || node.matches(":disabled")) throw new Error("Select unavailable");
          const option = Array.from(node.options).find((option) => (choice.value !== undefined ? option.value === choice.value : option.label === choice.label));
          if (!option || option.disabled || option.parentElement?.matches("optgroup:disabled")) throw new Error("Option unavailable");
        },
        { value: params.value, label: params.label },
      );
      await target.selectOption(params.selector!, params.value !== undefined ? { value: params.value } : { label: params.label! }, { timeout, force: true });
      break;
    }
    case "fill":
      await target.fill(params.selector!, params.text!, { timeout });
      break;
    case "press":
      if (params.selector) await target.press(params.selector, params.key!, { timeout });
      else await page.keyboard.press(params.key!);
      break;
    case "snapshot":
    case "text":
    case "screenshot":
      break;
  }
  if (page.url() === "about:blank") throw new NoPageError();
  const base: BrowserSuccess = { ok: true, url: page.url(), title: await page.title() };
  if (params.action === "snapshot") {
    base.snapshot = cap(await readBrowserSnapshot(page.mainFrame(), MAX_SNAPSHOT_CHARS, timeout, { selector: params.selector, framePath: params.framePath }), MAX_SNAPSHOT_CHARS);
    base.text = base.snapshot;
  } else if (params.action === "text") {
    base.text = cap(await readBrowserText(page.mainFrame(), MAX_SNAPSHOT_CHARS, timeout, { selector: params.selector, framePath: params.framePath }), MAX_SNAPSHOT_CHARS);
  } else if (params.action === "screenshot") {
    base.png = await page.screenshot({ fullPage: params.fullPage === true, timeout });
    const shot = describeShot(page.url());
    base.filename = shot.filename;
    base.caption = shot.caption;
  }
  return base;
}
