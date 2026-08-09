// What the relay refuses, and what it reclaims.
//
// The locked constraint is here in its strongest form: NOTHING is sent to an app
// that is not RUNNING, proven with a raw listener that counts TCP CONNECTIONS
// rather than HTTP requests. A stopped app's port is a free port and any local
// process could be sitting on it, so the relay must not open a socket to find
// out.
//
// The rest is the accounting: a permit taken before any socket and released on
// every way out — EOF, a bodyless response, a refusal, a client hanging up, a
// stall, a throw — because a leaked permit is a slow-motion outage rather than a
// visible failure.

import { afterEach, describe, expect, it } from "bun:test";
import { createServer, type Server as NetServer } from "net";
import { APP_RELAY_MAX_CONCURRENT_PER_APP, _testRelayInFlight, _testResetRelay } from "../host/proxy.ts";
import { APP_BUSY_BODY, APP_STOPPED_BODY, APP_UNREACHABLE_BODY } from "../host/responses.ts";
import { APP_HOST, appRecord, get, relay, startUpstream, type Upstream } from "./host-proxy-test-kit.ts";

let up: Upstream | null = null;
afterEach(() => {
  up?.stop();
  up = null;
  _testResetRelay();
});

describe("relay: refusing before connecting", () => {
  // A raw listener that counts TCP CONNECTIONS, not HTTP requests: the question
  // is whether anything was opened at all.
  async function withCountingListener(run: (port: number, connections: () => number) => Promise<void>): Promise<void> {
    let count = 0;
    const server: NetServer = createServer((socket) => {
      count++;
      socket.destroy();
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const port = (server.address() as { port: number }).port;
    try {
      await run(port, () => count);
    } finally {
      server.close();
    }
  }

  it("refuses every state that is not proof the app is up, without a connection", async () => {
    await withCountingListener(async (port, connections) => {
      const app = appRecord(port);
      for (const state of ["stopped", "failed", "starting", "unknown", "missing"] as const) {
        const res = await relay(get("/plain"), { app, state });
        expect({ state, status: res.status, body: await res.text() }).toEqual({ state, status: 503, body: APP_STOPPED_BODY });
      }
      expect(connections()).toBe(0);
    });
  });

  it("refuses when the supervisor itself cannot answer", async () => {
    await withCountingListener(async (port, connections) => {
      const res = await relay(get("/plain"), { app: appRecord(port), supervisorThrows: true });
      expect(res.status).toBe(503);
      expect(await res.text()).toBe(APP_STOPPED_BODY);
      expect(connections()).toBe(0);
    });
  });
});

describe("relay: failures", () => {
  it("answers 502 when nothing is listening on the app's port", async () => {
    // A port that was bound and released: nothing is there, so the connection
    // is refused — the shape of a running unit whose process just died.
    const scratch = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: () => new Response("x") });
    const port = scratch.port as number;
    void scratch.stop(true);
    const res = await relay(get("/plain"), { app: appRecord(port) });
    expect(res.status).toBe(502);
    expect(await res.text()).toBe(APP_UNREACHABLE_BODY);
    expect(_testRelayInFlight().total).toBe(0);
  });

  it("answers 502 when headers do not arrive in time", async () => {
    up = startUpstream();
    const res = await relay(get("/slow-headers"), { app: appRecord(up.port), ttfbMs: 150 });
    expect(res.status).toBe(502);
    expect(await res.text()).toBe(APP_UNREACHABLE_BODY);
    expect(_testRelayInFlight().total).toBe(0);
  });

  it("does not cut a stream off at the header deadline", async () => {
    // The TTFB timer is cleared when headers arrive: an SSE stream running long
    // past it is the feature, not a timeout. Several chunks are read, not one —
    // the first can come out of the stream's own queue and would survive an
    // abort that killed everything behind it.
    up = startUpstream();
    const res = await relay(get("/sse"), { app: appRecord(up.port), ttfbMs: 100 });
    const reader = res.body!.getReader();
    await Bun.sleep(300);
    for (let i = 0; i < 4; i++) {
      const chunk = await reader.read();
      expect({ i, done: chunk.done }).toEqual({ i, done: false });
    }
    await reader.cancel();
  });

  it("does not punish a slow client for the app's patience", async () => {
    // BACKPRESSURE, not a stall: the app produced a chunk and nobody has read
    // it yet. A guard that runs while the chunk sits in the queue would abort a
    // healthy app for the crime of being read slowly — and, since no read is
    // outstanding to notice the abort, would strand the permit too.
    up = startUpstream();
    const res = await relay(get("/sse"), { app: appRecord(up.port), stallMs: 150 });
    // Nothing is read for several times the stall window.
    await Bun.sleep(600);
    expect(up.aborted).toEqual([]);
    expect(_testRelayInFlight().total).toBe(1);
    // ...and the stream is still perfectly usable when the client gets around
    // to it.
    const reader = res.body!.getReader();
    const chunk = await reader.read();
    expect(chunk.done).toBe(false);
    await reader.cancel();
    await Bun.sleep(100);
    expect(_testRelayInFlight().total).toBe(0);
  });

  it("tears down a started response that goes silent", async () => {
    up = startUpstream();
    const res = await relay(get("/stall"), { app: appRecord(up.port), stallMs: 200 });
    const reader = res.body!.getReader();
    const first = await reader.read();
    expect(new TextDecoder().decode(first.value)).toBe("first\n");
    // The app is alive, the client is attached, and nothing is coming: the one
    // failure abort propagation cannot see.
    expect(reader.read()).rejects.toThrow();
    expect(_testRelayInFlight().total).toBe(0);
  });
});

describe("relay: the client going away", () => {
  it("reaches the app when the client cancels the response", async () => {
    up = startUpstream();
    const res = await relay(get("/sse"), { app: appRecord(up.port) });
    const reader = res.body!.getReader();
    await reader.read();
    await reader.cancel();
    await Bun.sleep(150);
    expect(up.aborted.length).toBeGreaterThan(0);
    expect(_testRelayInFlight().total).toBe(0);
  });

  it("does no upstream work for a client that is already gone", async () => {
    // The socket can die between the office receiving the request and the relay
    // reaching this point — a state lookup and a permit later. `abort` has
    // already fired by then, and addEventListener does not replay it.
    up = startUpstream();
    const ac = new AbortController();
    ac.abort();
    const res = await relay(new Request(`https://${APP_HOST}/plain`, { signal: ac.signal }), { app: appRecord(up.port) });
    expect(res.status).toBe(502);
    expect(await res.text()).toBe(APP_UNREACHABLE_BODY);
    // Whatever the runtime does with an aborted fetch, the app was never asked
    // to do anything, and the permit came back.
    expect(up.seen).toEqual([]);
    expect(_testRelayInFlight().total).toBe(0);
  });

  it("reaches the app when the request itself is aborted", async () => {
    up = startUpstream();
    const ac = new AbortController();
    const res = await relay(new Request(`https://${APP_HOST}/sse`, { signal: ac.signal }), { app: appRecord(up.port) });
    const reader = res.body!.getReader();
    await reader.read();
    ac.abort();
    expect(reader.read()).rejects.toThrow();
    await Bun.sleep(150);
    expect(up.aborted.length).toBeGreaterThan(0);
    expect(_testRelayInFlight().total).toBe(0);
  });
});

describe("relay: concurrency permits", () => {
  it("releases on every way out", async () => {
    up = startUpstream();
    const app = appRecord(up.port);
    // Normal EOF.
    await (await relay(get("/plain"), { app })).text();
    expect(_testRelayInFlight().total).toBe(0);
    // A null-body response releases without waiting for a stream that will
    // never come.
    await relay(get("/204"), { app });
    expect(_testRelayInFlight().total).toBe(0);
    await relay(get("/head-gzip", { method: "HEAD" }), { app });
    expect(_testRelayInFlight().total).toBe(0);
    // A refusal that never took one at all.
    await relay(get("/plain"), { app, state: "stopped" });
    expect(_testRelayInFlight().total).toBe(0);
  });

  it("holds exactly one permit while a stream is open", async () => {
    up = startUpstream();
    const res = await relay(get("/sse"), { app: appRecord(up.port) });
    const reader = res.body!.getReader();
    await reader.read();
    expect(_testRelayInFlight()).toEqual({ total: 1, perApp: 1 });
    await reader.cancel();
    await Bun.sleep(50);
    expect(_testRelayInFlight()).toEqual({ total: 0, perApp: 0 });
  });

  it("refuses over the shared total even when the app has room", async () => {
    up = startUpstream();
    const a = appRecord(up.port);
    const b = appRecord(up.port, { hostLabel: "other", hostGen: 1 });
    const limits = { maxPerApp: 4, maxTotal: 2 };
    const readers: ReadableStreamDefaultReader<Uint8Array>[] = [];
    for (const app of [a, b]) {
      const res = await relay(get("/sse"), { app, ...limits });
      const reader = res.body!.getReader();
      await reader.read();
      readers.push(reader);
    }
    expect(_testRelayInFlight()).toEqual({ total: 2, perApp: 1 });
    // Neither app is anywhere near its own cap; the office as a whole is full.
    const refused = await relay(get("/plain"), { app: a, ...limits });
    expect(refused.status).toBe(429);
    expect(await refused.text()).toBe(APP_BUSY_BODY);
    // A refusal takes nothing: the counters are exactly where they were.
    expect(_testRelayInFlight()).toEqual({ total: 2, perApp: 1 });
    for (const reader of readers) await reader.cancel();
    await Bun.sleep(50);
    expect(_testRelayInFlight()).toEqual({ total: 0, perApp: 0 });
  });

  it("refuses over the per-app cap and admits again once one finishes", async () => {
    up = startUpstream();
    const app = appRecord(up.port);
    const open: ReadableStreamDefaultReader<Uint8Array>[] = [];
    for (let i = 0; i < APP_RELAY_MAX_CONCURRENT_PER_APP; i++) {
      const res = await relay(get("/sse"), { app });
      const reader = res.body!.getReader();
      await reader.read();
      open.push(reader);
    }
    expect(_testRelayInFlight().perApp).toBe(APP_RELAY_MAX_CONCURRENT_PER_APP);
    const refused = await relay(get("/plain"), { app });
    expect(refused.status).toBe(429);
    expect(await refused.text()).toBe(APP_BUSY_BODY);

    await open.pop()!.cancel();
    await Bun.sleep(50);
    const admitted = await relay(get("/plain"), { app });
    expect(admitted.status).toBe(200);
    await admitted.text();
    for (const reader of open) await reader.cancel();
    await Bun.sleep(50);
    expect(_testRelayInFlight().total).toBe(0);
  });

  it("counts by issuance, so a reused name gets its own bucket", async () => {
    up = startUpstream();
    // Same NAME, next generation: a deleted app re-registered while an older
    // response is still unwinding. The two must not share a counter, or the
    // dead app's release would decrement the live app's bucket.
    const gen1 = appRecord(up.port);
    const gen2 = appRecord(up.port, { hostLabel: "hello-g2", hostGen: 2 });
    const first = await relay(get("/sse"), { app: gen1 });
    const firstReader = first.body!.getReader();
    await firstReader.read();
    const second = await relay(get("/sse"), { app: gen2 });
    const secondReader = second.body!.getReader();
    await secondReader.read();
    expect(_testRelayInFlight()).toEqual({ total: 2, perApp: 1 });
    await firstReader.cancel();
    await Bun.sleep(50);
    expect(_testRelayInFlight()).toEqual({ total: 1, perApp: 1 });
    await secondReader.cancel();
    await Bun.sleep(50);
    expect(_testRelayInFlight()).toEqual({ total: 0, perApp: 0 });
  });
});
