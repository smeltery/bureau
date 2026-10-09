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
  await page.goto(
    "data:text/html," +
      encodeURIComponent(
        `<h1>Offered page</h1><input id="message"><input type="file" id="file" oninput="this.dataset.input=1" onchange="this.dataset.change=1"><button id="go" onclick="document.querySelector('h1').textContent='Clicked'">Click</button>`,
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
  await action({ action: "click", selector: "#go" });
  assert.match((await action({ action: "read" })).text, /Clicked/);
  assert.equal((await action({ action: "screenshot" })).mimeType, "image/jpeg");
  await assert.rejects(action({ action: "read" }, "https://different.test"), /shared origin/);
  await worker.evaluate((id) => chrome.debugger.detach({ tabId: id }), tabId);
  console.log("Chrome debugger actions passed: read, type, upload, click, screenshot, origin mismatch refusal.");
} finally {
  await context?.close();
  await rm(profile, { recursive: true, force: true });
}
