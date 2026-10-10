import { performBrowserAction } from "../server/browser/perform.ts";
import { parseBrowserParams } from "../server/browser/params.ts";
import { BrowserDialogs } from "../server/browser/dialogs.ts";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { chromium } from "playwright-core";

// Optional real-Chrome check of the extension's fixed debugger actions.
// HTTP authorization and offered-tab lifecycle have separate Bun coverage.
// An inert data document avoids network dependencies in the debugger fixture.
const profile = await mkdtemp(join(tmpdir(), "bureau-browser-test-"));
const extension = resolve("browser-extension");
let context;
try {
  context = await chromium.launchPersistentContext(profile, {
    channel: "chromium",
    executablePath: process.env.BUREAU_BROWSER_EXECUTABLE || undefined,
    headless: process.env.BUREAU_BROWSER_HEADLESS === "1",
    ignoreDefaultArgs: ["--disable-extensions"],
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
  });
  context.setDefaultTimeout(15000);
  const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent("serviceworker", { timeout: 15000 }));
  const page = await context.newPage();
  // The extension owns dialog responses; prevent Playwright auto-dismiss races.
  page.on("dialog", () => {});
  await page.goto(
    "data:text/html," +
      encodeURIComponent(
        `<h1>Offered page</h1><button id="pointer" onpointerdown="window.pointerCount=(window.pointerCount||0)+1; this.remove()">Pointer</button><select id="choice" style="display:none" onchange="this.dataset.changed=1"><option value="a">First</option><option value="b">Second</option><option value="c" disabled>Disabled</option></select><button id="confirm" onclick="window.confirmed=confirm('Proceed?')">Confirm</button><input id="message"><input type="file" id="file" oninput="this.dataset.input=1" onchange="this.dataset.change=1"><button id="go" onclick="document.querySelector('h1').textContent='Clicked'">Click</button>`,
      ),
  );
  const tabId = await worker.evaluate(async () => (await chrome.tabs.query({})).find((tab) => tab.url?.startsWith("data:text/html,")).id);
  await worker.evaluate((id) => chrome.debugger.attach({ tabId: id }, "1.3"), tabId);
  const action = (input, origin = "null") => worker.evaluate((command) => execute(command), { tabId, origin, input });
  assert.match((await action({ action: "read" })).text, /Offered page/);
  await action({ action: "type", selector: "#message", text: "Shared text" });
  assert.equal(await page.locator("#message").inputValue(), "Shared text");
  const file = { name: "report.txt", mimeType: "text/plain", base64: Buffer.from("Uploaded contents").toString("base64") };
  assert.deepEqual(await action({ action: "upload", selector: "#file", file }), { name: "report.txt", mimeType: "text/plain", size: 17 });
  assert.deepEqual(await page.locator("#file").evaluate(async (input) => ({ text: await input.files[0].text(), input: input.dataset.input, change: input.dataset.change })), {
    text: "Uploaded contents",
    input: "1",
    change: "1",
  });
  await assert.rejects(action({ action: "upload", selector: "#message", file }), /Page action failed/);
  await assert.rejects(action({ action: "upload", selector: "#file", file }, "https://different.test"), /shared origin/);
  await action({ action: "click", selector: "#pointer" });
  assert.equal(await page.evaluate(() => window.pointerCount), 1);
  assert.deepEqual(await action({ action: "select", selector: "#choice", label: "Second" }), { values: ["b"] });
  assert.equal(await page.locator("#choice").inputValue(), "b");
  assert.equal(await page.locator("#choice").getAttribute("data-changed"), "1");
  await assert.rejects(action({ action: "select", selector: "#choice", value: "c" }), /Page action failed/);
  let dialogResult = await action({ action: "click", selector: "#confirm" });
  assert.deepEqual(dialogResult.dialogs, [{ type: "confirm", message: "Proceed?", accepted: false }]);
  assert.equal(await page.evaluate(() => window.confirmed), false);
  dialogResult = await action({ action: "click", selector: "#confirm", dialog: "accept" });
  assert.equal(dialogResult.dialogs[0].accepted, true);
  assert.equal(await page.evaluate(() => window.confirmed), true);
  await action({ action: "click", selector: "#go" });
  assert.match((await action({ action: "read" })).text, /Clicked/);
  assert.equal((await action({ action: "screenshot" })).mimeType, "image/jpeg");
  await assert.rejects(action({ action: "read" }, "https://different.test"), /shared origin/);
  await worker.evaluate((id) => chrome.debugger.detach({ tabId: id }), tabId);
  const hostDialogs = new BrowserDialogs();
  hostDialogs.watch(page);
  const hostAction = async (input) => {
    const params = parseBrowserParams(input);
    assert.equal(params.ok, true);
    const finish = hostDialogs.begin(params.dialog);
    return finish(await performBrowserAction(page, params, 2000, () => {}));
  };
  await hostAction({ action: "select", selector: "#choice", value: "a" });
  assert.equal(await page.locator("#choice").inputValue(), "a");
  const hostResult = await hostAction({ action: "click", selector: "#confirm", dialog: "accept" });
  assert.equal(hostResult.dialogs[0].accepted, true);
  assert.equal(await page.evaluate(() => window.confirmed), true);
  await page.evaluate(() => {
    const button = document.createElement("button");
    button.id = "host-pointer";
    button.textContent = "Host pointer";
    button.onpointerdown = () => {
      window.hostPointerCount = (window.hostPointerCount || 0) + 1;
      button.remove();
    };
    document.body.append(button);
  });
  await hostAction({ action: "click", selector: "#host-pointer" });
  assert.equal(await page.evaluate(() => window.hostPointerCount), 1);
  console.log("Chrome debugger actions passed: read, type, upload, pointer click, select, dialogs, screenshot, origin mismatch refusal.");
} finally {
  await context?.close();
  await rm(profile, { recursive: true, force: true });
}
