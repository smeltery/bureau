import { afterEach, describe, expect, it } from "bun:test";
import type { OpenCodeLease } from "../supervisor.ts";
import { OpenCodeModelCatalog, OpenCodeModelSelection, waitForCatalog } from "./model-catalog.ts";

const cleanup: Array<() => void> = [];
afterEach(() => {
  for (const dispose of cleanup.splice(0).reverse()) dispose();
});
const payload = { connected: ["test"], all: [{ id: "test", models: { model: { name: "Model", variants: { low: {}, high: {}, invented: {} }, limit: { context: 128000 } } } }] };

function fixture(handler: (directory: string) => Response | Promise<Response>) {
  const server = Bun.serve({
    port: 0,
    fetch(req) {
      return handler(new URL(req.url).searchParams.get("directory") ?? "");
    },
  });
  cleanup.push(() => server.stop(true));
  const lease: OpenCodeLease = { baseUrl: `http://127.0.0.1:${server.port}`, authHeader: "Basic test", pid: 1, release() {}, async beginTurn() {}, async recoverBeforePrompt() {}, endTurn() {} };
  return lease;
}

describe("OpenCode model catalog", () => {
  it("shares an in-flight load and caches success by directory and server identity", async () => {
    const calls: string[] = [];
    const lease = fixture((directory) => {
      calls.push(directory);
      return Response.json(payload);
    });
    const catalog = new OpenCodeModelCatalog();
    const first = catalog.load(lease, "/one");
    expect(catalog.load(lease, "/one")).toBe(first);
    const models = await first;
    expect(models[0]).toMatchObject({ contextLimit: 128000, supportedEfforts: [{ level: "low" }, { level: "high" }] });
    await catalog.load(lease, "/one");
    await catalog.load(lease, "/two");
    lease.pid = 2;
    await catalog.load(lease, "/one");
    expect(calls).toEqual(["/one", "/two", "/one"]);
  });

  it("retains a late success after a turn stops waiting", async () => {
    let calls = 0;
    let finish!: () => void;
    const ready = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const lease = fixture(async () => {
      calls++;
      await ready;
      return Response.json(payload);
    });
    const catalog = new OpenCodeModelCatalog();
    const load = catalog.load(lease, "/one");
    await expect(waitForCatalog(load, 20)).rejects.toThrow("not ready");
    finish();
    await load;
    await catalog.load(lease, "/one");
    expect(calls).toBe(1);
  });

  it("retries failed loads on a later turn but does not repeat a failed prefetch", async () => {
    let calls = 0;
    const lease = fixture(() => {
      calls++;
      return calls === 1 ? new Response(null, { status: 503 }) : Response.json(payload);
    });
    const catalog = new OpenCodeModelCatalog();
    const selection = new OpenCodeModelSelection(catalog, "/one", "test/model", "high");
    selection.prefetch(lease);
    await Bun.sleep(30);
    expect(await selection.resolve(lease)).toHaveProperty("notice");
    expect(calls).toBe(1);
    expect(await selection.resolve(lease)).toEqual({ variant: "high" });
    expect(selection.contextLimit).toBe(128000);
    expect(calls).toBe(2);
  });

  it("reports an unsupported effort and leaves models without variants alone", async () => {
    const lease = fixture(() => Response.json(payload));
    const catalog = new OpenCodeModelCatalog();
    const unsupported = new OpenCodeModelSelection(catalog, "/one", "test/model", "max");
    expect(await unsupported.resolve(lease)).toMatchObject({ notice: expect.stringContaining("default effort") });
    const missing = new OpenCodeModelSelection(catalog, "/one", "test/other", "high");
    expect(await missing.resolve(lease)).toEqual({});
    expect(missing.contextLimit).toBeUndefined();
  });

  it("bounds a stuck load so a later request can retry", async () => {
    let calls = 0;
    const lease = fixture(() => {
      calls++;
      return calls === 1 ? new Promise<Response>(() => {}) : Response.json(payload);
    });
    const catalog = new OpenCodeModelCatalog(20);
    await expect(catalog.load(lease, "/one")).rejects.toThrow();
    expect(await catalog.load(lease, "/one")).toHaveLength(1);
    expect(calls).toBe(2);
  });
});
