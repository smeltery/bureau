import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createContext, runInContext } from "node:vm";

function extensionFixture() {
  const root = join(import.meta.dir, "../../browser-extension");
  const storage: Record<string, unknown> = {};
  const requests: { path: string; headers: Record<string, string>; body: any }[] = [];
  const commands: any[] = [];
  const results: any[] = [];
  const attached = new Set<number>();
  let offered: any = null;
  const listeners: Record<string, (...args: any[]) => unknown> = {};
  const context = createContext({
    URL,
    Response,
    AbortSignal,
    setTimeout,
    clearTimeout,
    setInterval: () => 0,
    chrome: {
      runtime: {
        id: "a".repeat(32),
        getURL: (path: string) => `chrome-extension://${"a".repeat(32)}/${path}`,
        onMessage: {
          addListener: (callback: any) => {
            listeners.message = callback;
          },
        },
      },
      storage: { local: { get: async (key: string) => ({ [key]: storage[key] }), set: async (row: object) => Object.assign(storage, row) }, session: { get: async () => ({}), set: async () => {} } },
      action: { setBadgeText: async () => {}, setBadgeBackgroundColor: async () => {} },
      alarms: { create: async () => {}, onAlarm: { addListener: () => {} } },
      tabs: {
        get: async (id: number) => ({ id, url: "https://offered.test/page", title: "Private page" }),
        onRemoved: {
          addListener: (callback: any) => {
            listeners.remove = callback;
          },
        },
        onUpdated: {
          addListener: (callback: any) => {
            listeners.update = callback;
          },
        },
      },
      debugger: {
        attach: async ({ tabId }: { tabId: number }) => {
          attached.add(tabId);
        },
        detach: async ({ tabId }: { tabId: number }) => {
          attached.delete(tabId);
        },
        onDetach: {
          addListener: (callback: any) => {
            listeners.detach = callback;
          },
        },
        sendCommand: async (_target: unknown, method: string) =>
          method === "Page.getFrameTree" ? { frameTree: { frame: { url: "https://offered.test/page" } } } : { result: { value: { text: "Visible text" } } },
      },
    },
    fetch: async (url: string, options: any = {}) => {
      const path = new URL(url).pathname.split("/extension/")[1];
      const body = options.body ? JSON.parse(options.body) : null;
      requests.push({ path, headers: options.headers, body });
      if (path === "pair") return Response.json({ token: "paired-token" });
      if (path === "agents") return Response.json([{ id: "agent", name: "Helper" }]);
      if (path === "grants") {
        offered = { ...body, id: "grant", origin: "https://offered.test", expiresAt: null };
        return Response.json(offered);
      }
      if (path === "poll") return Response.json({ grants: offered ? [offered] : [], commands: commands.splice(0) });
      if (path.startsWith("results/")) results.push(body);
      if (path.startsWith("grants/")) offered = null;
      return new Response(null, { status: 204 });
    },
  });
  context.importScripts = (path: string) => runInContext(readFileSync(join(root, path), "utf8"), context);
  runInContext(readFileSync(join(root, "worker.js"), "utf8"), context);
  const call = (input: unknown) => {
    context.input = input;
    return runInContext("handle(input)", context) as Promise<any>;
  };
  const poll = () => runInContext("poll()", context) as Promise<void>;
  return { call, poll, attached, requests, results, commands, listeners };
}

test("packaged worker pairs, offers only selected tabs, delivers results and detaches on navigation", async () => {
  const fixture = extensionFixture();
  await fixture.call({ action: "pair", office: "http://localhost:4000", code: "one-use" });
  expect(fixture.requests[0]).toMatchObject({ path: "pair", body: { code: "one-use" }, headers: { "X-Bureau-Extension": "a".repeat(32) } });
  await fixture.call({ action: "share", tabId: 9, agentIds: ["agent"], minutes: null });
  expect([...fixture.attached]).toEqual([9]);
  fixture.commands.push({ id: "command", grantId: "grant", tabId: 9, origin: "https://offered.test", input: { action: "read" } });
  await fixture.poll();
  expect(fixture.results).toEqual([{ result: { text: "Visible text" } }]);
  expect(fixture.requests.find((request) => request.path === "poll")?.headers.Authorization).toBe("Bearer paired-token");
  fixture.listeners.update(9, { url: "https://different.test" });
  await fixture.poll();
  expect(fixture.attached.size).toBe(0);
  expect((await fixture.call({ action: "status" })).grants).toHaveLength(0);
});

test("worker refuses foreign popup messages and commands for an unoffered tab", async () => {
  const fixture = extensionFixture();
  expect(fixture.listeners.message({ action: "share" }, { id: "other", url: "https://evil.test" }, () => {})).toBe(false);
  await fixture.call({ action: "pair", office: "http://localhost:4000", code: "one-use" });
  await fixture.call({ action: "share", tabId: 9, agentIds: ["agent"], minutes: null });
  fixture.commands.push({ id: "command", grantId: "grant", tabId: 10, origin: "https://offered.test", input: { action: "read" } });
  await fixture.poll();
  expect(fixture.results).toHaveLength(0);
  await fixture.call({ action: "revoke", id: "grant" });
  expect(fixture.attached.size).toBe(0);
});
