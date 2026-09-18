// Stubbed-CDP tests for live screencast, mouse button on drag, and selection copy.
import { describe, expect, test } from "bun:test";
import { runInNewContext } from "node:vm";
import { BrowserPool, MAX_TEXT_CHARS, type BrowserResult } from "../session.ts";

interface StubCalls {
  launches: number;
  contexts: number;
  closedContexts: number;
  browserClosed: number;
  actions: string[];
  cdp: Array<{ method: string; params?: Record<string, unknown> }>;
}

function stubBrowser(calls: StubCalls, page: Record<string, unknown> = {}, options: { screenshot?: () => Promise<{ data: string }> } = {}) {
  const defaults = {
    url: () => "http://127.0.0.1:3000/",
    title: async () => "Example",
    goto: async (u: string) => {
      calls.actions.push(`goto:${u}`);
    },
    click: async () => {},
    fill: async () => {},
    press: async () => {},
    keyboard: { press: async () => {} },
    locator: () => ({ ariaSnapshot: async () => '- heading "hi"' }),
    screenshot: async () => Buffer.from("PNG"),
    viewportSize: () => ({ width: 1280, height: 800 }),
    evaluate: async () => ({ text: "", truncated: false }),
  };
  function makePage(): Record<string, unknown> {
    let closed = false;
    return {
      ...defaults,
      ...page,
      isClosed: () => closed,
      close: async () => {
        closed = true;
      },
    };
  }
  const cdpSessions: Array<{ emit: (event: string, value: never) => void }> = [];
  const instances: Array<{ isConnected: () => boolean }> = [];

  function makeBrowser() {
    let connected = true;
    const browser = {
      isConnected: () => connected,
      newContext: async () => {
        calls.contexts++;
        const listeners: Array<(p: unknown) => void> = [];
        const pages: Array<Record<string, unknown>> = [];
        return {
          newPage: async () => {
            const fresh = makePage();
            pages.push(fresh);
            return fresh;
          },
          on: (event: string, fn: (p: unknown) => void) => {
            if (event === "page") listeners.push(fn);
          },
          close: async () => {
            calls.closedContexts++;
          },
          newCDPSession: async () => {
            const map = new Map<string, (event: never) => void>();
            const cdp = {
              on: (event: string, fn: (event: never) => void) => map.set(event, fn),
              send: async (method: string, params?: Record<string, unknown>) => {
                calls.cdp.push({ method, params });
                if (method === "Page.captureScreenshot") return options.screenshot?.();
              },
              detach: async () => {},
              emit: (event: string, value: never) => map.get(event)?.(value),
            };
            cdpSessions.push(cdp);
            return cdp;
          },
        };
      },
      close: async () => {
        calls.browserClosed++;
        connected = false;
      },
    };
    instances.push(browser);
    return browser;
  }
  return { cdpSessions, makeBrowser };
}

function poolWith(calls: StubCalls, page?: Record<string, unknown>, options: { screenshot?: () => Promise<{ data: string }> } = {}) {
  const stub = stubBrowser(calls, page, options);
  const pool = new BrowserPool({
    findBrowser: () => "/fake/chrome",
    launch: async () => {
      calls.launches++;
      return stub.makeBrowser() as never;
    },
    idleMs: 60_000,
    publicHostAllowlist: [],
    lookupFn: async () => [{ address: "127.0.0.1", family: 4 }],
  });
  return { pool, stub };
}

function freshCalls(): StubCalls {
  return { launches: 0, contexts: 0, closedContexts: 0, browserClosed: 0, actions: [], cdp: [] };
}

async function opened(pool: BrowserPool, agentId: string): Promise<BrowserResult> {
  return pool.run(agentId, { action: "goto", url: "http://127.0.0.1:3000/" });
}

describe("BrowserPool live screencast", () => {
  test("streams frames only while a viewer is attached and dispatches mouse with button", async () => {
    const calls = freshCalls();
    const { pool, stub } = poolWith(calls);
    const frames: Array<unknown> = [];
    const stop = pool.watch("a", (frame) => frames.push(frame));
    expect(frames).toEqual([null]);

    await opened(pool, "a");
    expect(calls.cdp.some((c) => c.method === "Page.startScreencast")).toBe(true);
    const stopSecond = pool.watch("a", () => {});
    expect(calls.cdp.filter((c) => c.method === "Page.startScreencast")).toHaveLength(1);

    stub.cdpSessions[0]!.emit("Page.screencastFrame", {
      data: "jpeg",
      sessionId: 7,
      metadata: { deviceWidth: 1280, deviceHeight: 800 },
    } as never);
    expect(frames.at(-1)).toEqual({ data: "jpeg", width: 1280, height: 800 });
    expect(calls.cdp.some((c) => c.method === "Page.screencastFrameAck")).toBe(true);

    expect(
      await pool.humanInput("a", {
        kind: "mouse",
        event: "mouseMoved",
        x: 12,
        y: 18,
        button: "left",
        clickCount: 0,
      }),
    ).toBe(true);
    expect(calls.cdp).toContainEqual({
      method: "Input.dispatchMouseEvent",
      params: { type: "mouseMoved", x: 12, y: 18, button: "left", clickCount: 0 },
    });

    stop();
    await Bun.sleep(0);
    expect(calls.cdp.some((c) => c.method === "Page.stopScreencast")).toBe(false);
    stopSecond();
    await Bun.sleep(0);
    expect(calls.cdp.some((c) => c.method === "Page.stopScreencast")).toBe(true);
    await pool.shutdown();
  });

  test("seeds a quiet page once when screencast emits no frame", async () => {
    const calls = freshCalls();
    let resolve!: (shot: { data: string }) => void;
    const screenshot = new Promise<{ data: string }>((done) => {
      resolve = done;
    });
    const { pool } = poolWith(calls, {}, { screenshot: () => screenshot });
    await opened(pool, "quiet");
    const frames: unknown[] = [];
    const stop = pool.watch("quiet", (frame) => {
      if (frame) frames.push(frame);
    });
    await Bun.sleep(0);
    resolve({ data: "seed" });
    await Bun.sleep(0);
    expect(frames).toEqual([{ data: "seed", width: 1280, height: 800 }]);
    stop();
    await pool.shutdown();
  });

  test("captures a still after human input so quiet pages do not stay stale", async () => {
    const calls = freshCalls();
    const { pool } = poolWith(calls, {}, { screenshot: async () => ({ data: "after-input" }) });
    const frames: unknown[] = [];
    const stop = pool.watch("a", (frame) => {
      if (frame) frames.push(frame);
    });
    try {
      await opened(pool, "a");
      await pool.humanInput("a", {
        kind: "mouse",
        event: "mousePressed",
        x: 42,
        y: 24,
        button: "left",
        clickCount: 1,
      });
      expect(calls.cdp.some((c) => c.method === "Page.captureScreenshot" && !!c.params)).toBe(true);
      expect(frames.at(-1)).toEqual({ data: "after-input", width: 1280, height: 800 });
    } finally {
      stop();
      await pool.shutdown();
    }
  });

  test("reads only the active selection, caps it, and does not open a missing page", async () => {
    let selected = "";
    const calls = freshCalls();
    const { pool } = poolWith(calls, {
      evaluate: async (fn: (limit: number) => unknown, limit: number) =>
        runInNewContext(`(${fn.toString()})(${limit})`, {
          window: { getSelection: () => ({ toString: () => selected }) },
        }),
    });
    try {
      expect(
        await pool.selection("missing").then(
          () => false,
          () => true,
        ),
      ).toBe(true);
      expect(calls.contexts).toBe(0);
      await opened(pool, "selected");
      expect(await pool.selection("selected")).toEqual({ text: "", truncated: false });
      selected = "selected words";
      expect(await pool.selection("selected")).toEqual({ text: selected, truncated: false });
      selected = "x".repeat(MAX_TEXT_CHARS + 1);
      expect(await pool.selection("selected")).toEqual({ text: "x".repeat(MAX_TEXT_CHARS), truncated: true });
      expect(calls.actions).toHaveLength(1);
    } finally {
      await pool.shutdown();
    }
  });

  test("reports idle-closed state until the browser is reopened or explicitly closed", async () => {
    const calls = freshCalls();
    const { pool } = poolWith(calls);
    try {
      await opened(pool, "a");
      await pool.close("a", "idle");
      expect(pool.status("a")).toEqual({ available: false, url: "", title: "", idleClosed: true });
      await opened(pool, "a");
      const reopened = pool.status("a");
      expect(reopened.available).toBe(true);
      expect(reopened.idleClosed).toBeUndefined();
      await pool.close("a");
      expect(pool.status("a")).toEqual({ available: false, url: "", title: "", idleClosed: undefined });
    } finally {
      await pool.shutdown();
    }
  });

  test("drops mismatched frame metadata without caching it", async () => {
    const calls = freshCalls();
    const { pool, stub } = poolWith(calls);
    const frames: unknown[] = [];
    const stop = pool.watch("a", (frame) => {
      if (frame) frames.push(frame);
    });
    try {
      await opened(pool, "a");
      stub.cdpSessions[0]!.emit("Page.screencastFrame", {
        data: "stale",
        sessionId: 1,
        metadata: { deviceWidth: 640, deviceHeight: 800 },
      } as never);
      expect(frames).toEqual([]);
      stub.cdpSessions[0]!.emit("Page.screencastFrame", {
        data: "current",
        sessionId: 1,
        metadata: { deviceWidth: 1280, deviceHeight: 800 },
      } as never);
      expect(frames).toEqual([{ data: "current", width: 1280, height: 800 }]);
    } finally {
      stop();
      await pool.shutdown();
    }
  });

  test("raises page DPR and publishes stills when a watcher asks for sharp captures", async () => {
    const calls = freshCalls();
    const { pool, stub } = poolWith(calls, {}, { screenshot: async () => ({ data: "hi-dpr" }) });
    const frames: unknown[] = [];
    const stop = pool.watch(
      "a",
      (frame) => {
        if (frame) frames.push(frame);
      },
      { maxWidth: 2560, maxHeight: 1600, deviceScaleFactor: 2 },
    );
    try {
      await opened(pool, "a");
      expect(calls.cdp).toContainEqual({
        method: "Emulation.setDeviceMetricsOverride",
        params: { width: 1280, height: 800, deviceScaleFactor: 2, mobile: false },
      });
      const cast = calls.cdp.find((c) => c.method === "Page.startScreencast");
      expect(cast?.params).toMatchObject({ maxWidth: 1280, maxHeight: 800, everyNthFrame: 1 });
      stub.cdpSessions[0]!.emit("Page.screencastFrame", {
        data: "trigger",
        sessionId: 3,
        metadata: { deviceWidth: 1280, deviceHeight: 800 },
      } as never);
      await Bun.sleep(0);
      expect(calls.cdp.some((c) => c.method === "Page.captureScreenshot")).toBe(true);
      expect(frames.at(-1)).toEqual({ data: "hi-dpr", width: 1280, height: 800 });
      const shot = calls.cdp.find((c) => c.method === "Page.captureScreenshot");
      expect((shot?.params as { clip?: { scale?: number } } | undefined)?.clip?.scale).toBe(1);
    } finally {
      stop();
      await pool.shutdown();
    }
  });
});
