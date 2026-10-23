import { readFileSync, existsSync } from "node:fs";
import assert from "node:assert/strict";
import { chromium } from "playwright-core";
import { DEFAULT_AGENT_CAPABILITIES } from "../shared/types.ts";

// Real-browser UI check with local office/app fixtures. Authentication and
// origin policies are tested separately against the production handlers.
const sockets = new Set();
let generation = 1,
  assigned = "a",
  denied = false;
const agents = ["a", "b"].map((id) => ({
  id,
  name: id === "a" ? "Ada" : "Ben",
  desk: 0,
  room: 0,
  roomId: "room",
  cwd: "/tmp",
  outfit: { hat: "none", color: "#335577", hair: "#222222", hairStyle: "short", skin: "#ddaabb", beard: "none", accessory: null },
  permissionMode: "default",
  modelFamily: "sonnet",
  agentType: "claude",
  capabilities: DEFAULT_AGENT_CAPABILITIES,
  state: "idle",
  topic: null,
  topicStale: false,
  customInstructions: null,
}));
let browser;
try {
  browser = await chromium.launch({ channel: "chromium", headless: true, executablePath: process.env.BUREAU_BROWSER_EXECUTABLE || undefined });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  page.setDefaultTimeout(30000);
  page.setDefaultNavigationTimeout(120000);
  const errors = [];
  page.on("pageerror", (error) => {
    errors.push(error.message);
    console.error(error.message);
  });
  await page.route("http://app.test/**", (route) => route.fulfill({ contentType: "text/html", body: "<h1>App fixture</h1>" }));
  await page.route("http://office.test/**", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith("/chat-view"))
      return route.fulfill({
        status: denied ? 404 : 200,
        json: denied ? { error: "not_found" } : { name: "board", hostGen: generation, appUrl: "http://app.test/", agentId: assigned, sessionExpiresAt: Date.now() + 600_000 },
      });
    if (url.pathname === "/api/questions") return route.fulfill({ json: { questions: [] } });
    if (url.pathname === "/api/integrations/requests") return route.fulfill({ json: { requests: [] } });
    if (url.pathname.startsWith("/api/")) return route.fulfill({ json: {} });
    if (url.pathname === "/board")
      return route.fulfill({
        contentType: "text/html",
        body: readFileSync("ui/dist/index.html", "utf8").replace(
          '<div id="root"></div>',
          `<div id="root"></div><script>window.__BUREAU_APP__=${JSON.stringify({ name: "board", hostGen: generation })}</script>`,
        ),
      });
    const path = `ui/dist${url.pathname}`;
    const contentType = path.endsWith(".js") ? "application/javascript" : path.endsWith(".css") ? "text/css" : "application/octet-stream";
    return route.fulfill(existsSync(path) ? { contentType, body: readFileSync(path) } : { status: 404, body: "not found" });
  });
  await page.routeWebSocket("ws://office.test/ws", (ws) => {
    sockets.add(ws);
    ws.onClose(() => sockets.delete(ws));
    ws.onMessage((raw) => {
      if (JSON.parse(String(raw)).type === "ping") ws.send(JSON.stringify({ type: "pong" }));
    });
    ws.send(JSON.stringify({ type: "session_context", context: { userId: "owner", username: "Owner", role: "owner", currentSessionPrefix: "test", connectionId: "test" } }));
    ws.send(
      JSON.stringify({
        type: "full_state",
        agents,
        recentCwds: [],
        rooms: [{ id: "room", name: "Room" }],
        killedAgents: [],
        office: { prompt: null, envFile: null, previewAllowHosts: [], experimental: {}, receptionistAgentId: null },
      }),
    );
    ws.send(JSON.stringify({ type: "log_replay_complete" }));
  });
  await page.goto("http://office.test/board?tab=2", { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: "Chat with Ada" }).click();
  const input = page.locator("textarea").first();
  await input.fill("Keep this app draft");
  if (process.env.BUREAU_CHAT_SCREENSHOTS) await page.screenshot({ path: "/tmp/bureau-app-chat-desktop.png" });
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: "Chat with Ada" }).click();
  await input.waitFor();
  assert.equal(await input.inputValue(), "Keep this app draft");
  assigned = "b";
  for (const ws of sockets) ws.send(JSON.stringify({ type: "app_removed", name: "board" }));
  await page.getByRole("region", { name: "Chat with Ben" }).waitFor();
  assert.equal(await input.inputValue(), "");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForFunction(() => getComputedStyle(document.querySelector("iframe")).display === "none");
  if (process.env.BUREAU_CHAT_SCREENSHOTS) await page.screenshot({ path: "/tmp/bureau-app-chat-mobile.png" });
  await page.getByRole("button", { name: "Close chat" }).click();
  await page.locator("iframe").waitFor({ state: "visible" });
  denied = true;
  for (const ws of sockets) ws.send(JSON.stringify({ type: "app_removed", name: "board" }));
  await page.getByRole("alert").filter({ hasText: "no longer available" }).waitFor();
  assert.equal(await page.locator("iframe").count(), 0);
  assert.deepEqual(errors, []);
  console.log("App chat passed: desktop chat, draft reload, handoff isolation, mobile layout, access removal.");
} finally {
  await browser?.close();
}
