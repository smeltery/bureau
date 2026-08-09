// An app that stops reading, and the close handshake in the conditions where it
// is hard.
//
// This is the group the in-house client exists for. Bun's own WebSocket client
// would swallow all of it with `bufferedAmount` stuck at 0 (measured: 120MB of
// sends to a peer that had stopped reading grew the process to 211MB RSS), so the
// assertions here are about a queue with a number on it and a close that still
// gets out.

import { afterEach, describe, expect, it } from "bun:test";
import type { TCPSocketListener } from "bun";
import type { AppUpstream, UpstreamCloseEvent } from "../host/ws-upstream.ts";
import { collector, dial, fillQueue, makeFakeConnector, startPeer, until } from "./host-ws-kit.ts";

let peer: TCPSocketListener<undefined> | null = null;
let live: AppUpstream | null = null;

afterEach(() => {
  live?.terminate("test teardown");
  live = null;
  peer?.stop(true);
  peer = null;
});

async function dialPeer(port: number, got: ReturnType<typeof collector>, extra: Parameters<typeof dial>[2] = {}) {
  const result = await dial(port, got, extra);
  if (result.ok) live = result.connection;
  return result;
}

// The app's close frame, unmasked: 1001 "away".
const APP_CLOSE_1001_AWAY = Buffer.from([0x88, 0x06, 0x03, 0xe9, 0x61, 0x77, 0x61, 0x79]);

describe("host-ws-upstream: an app that stops reading", () => {
  it("bounds the queue and reports queue_full instead of growing", async () => {
    peer = startPeer({ stopReading: true });
    const got = collector();
    const dialed = await dialPeer(peer.port, got, { limits: { queueMaxBytes: 64 * 1024, controlReserveBytes: 4 * 1024, maxMessageBytes: 16 * 1024 } });
    expect(dialed.ok).toBe(true);
    const chunk = Buffer.alloc(16 * 1024, 7);
    let full = 0;
    let sent = 0;
    for (let i = 0; i < 500; i++) {
      const outcome = live!.sendBinary(chunk);
      if (outcome === "queue_full") {
        full++;
        break;
      }
      sent++;
    }
    expect(full).toBe(1);
    // The bound holds: what the socket would not take is held, and what is held
    // is under the ceiling. (The socket accepts a good deal into its own send
    // buffer first, which is why `sent` is larger than the queue.)
    expect(sent).toBeGreaterThan(0);
    expect(live!.queuedBytes()).toBeLessThanOrEqual(64 * 1024);
    expect(live!.heldBytes()).toBeLessThanOrEqual(64 * 1024);
  });

  it("can still send a close when the data queue is full", async () => {
    // The reserve's whole purpose: a connection that has to end must be able to
    // say so, even when the app has stopped reading.
    peer = startPeer({ stopReading: true });
    const got = collector();
    await dialPeer(peer.port, got, { limits: { queueMaxBytes: 64 * 1024, controlReserveBytes: 4 * 1024, maxMessageBytes: 16 * 1024, closeHandshakeMs: 100 } });
    // PACK the data queue, in two passes. Big frames get it near the data
    // ceiling fast; small ones then close the gap to under one small frame. This
    // matters: filling with 16KB frames alone leaves up to 16KB of slack under
    // the ceiling, and a close frame fits in that slack whether the reserve
    // exists or not — so the test would pass with the reserve deleted.
    const big = Buffer.alloc(16 * 1024, 7);
    fillQueue(() => live!.sendBinary(big), "big frames", big.length);
    const small = Buffer.alloc(32, 7);
    fillQueue(() => live!.sendBinary(small), "packing frames", small.length);
    const before = live!.queuedBytes();
    // Under the DATA ceiling there is now less than one 38-byte frame of room,
    // so this close frame — 2 code bytes plus a 123-byte reason plus a 6-byte
    // masked header, 131 on the wire — can only be queued out of the control
    // reserve.
    const longReason = "x".repeat(123);
    live!.sendClose(1001, longReason);
    expect(live!.queuedBytes()).toBe(before + 131);
    // The peer never answers, so the close handshake times out and the socket
    // goes — exactly once.
    await until(() => got.closes.length > 0, "the close handshake timeout");
    expect(got.closes.length).toBe(1);
    expect(got.closes[0].abnormal).toBe(true);
    expect(got.closes[0].detail).toContain("close handshake timed out");
  });

  it("drains the queue when the app starts reading again", async () => {
    // The other half of the backpressure contract: a partial write is resumed
    // by `drain`, not by a timer or a retry loop.
    let resume: (() => void) | null = null;
    peer = startPeer({
      stopReading: true,
      onUpgraded(socket) {
        resume = () => {
          socket.resume();
        };
      },
    });
    const got = collector();
    await dialPeer(peer.port, got, { limits: { queueMaxBytes: 512 * 1024, maxMessageBytes: 64 * 1024 } });
    const chunk = Buffer.alloc(64 * 1024, 3);
    fillQueue(() => live!.sendBinary(chunk), "drain fill", chunk.length);
    expect(live!.queuedBytes()).toBeGreaterThan(0);
    resume!();
    await until(() => live!.queuedBytes() === 0, "the queue to drain", 4000);
    expect(live!.queuedBytes()).toBe(0);
  });
});

describe("host-ws-upstream: the close handshake", () => {
  it("completes when the app answers and keeps TCP open", async () => {
    // A well-behaved app answers our close and leaves the socket to us. Bun's own
    // server hides this by dropping TCP as well; a fake peer does not, and without
    // parsing while closing this case was reported as an abnormal close after the
    // full timeout — a polite goodbye recorded as a failure.
    const fake = makeFakeConnector({ autoUpgrade: true });
    const got = collector();
    const dialed = await dialPeer(4007, got, { connector: fake.connector, limits: { closeHandshakeMs: 5000 } });
    expect(dialed.ok).toBe(true);
    live!.sendClose(1001, "going away", "browser left");
    // The app's close RESPONSE, unmasked, socket left open.
    fake.data(Buffer.from([0x88, 0x02, 0x03, 0xe9]));
    expect(got.closes.length).toBe(1);
    expect(got.closes[0]).toEqual({ code: 1001, reason: "going away", abnormal: false, detail: "browser left" });
    // No second event when the timer would have fired.
    await Bun.sleep(80);
    expect(got.closes.length).toBe(1);
  });

  it("calls it abnormal when the app vanishes instead of answering our close", async () => {
    // The contrast with the test above: same locally initiated close, but the peer
    // drops TCP rather than answering. Our code and reason are still the truth
    // about why we closed — the HANDSHAKE is what did not complete — so the event
    // keeps them and adds the abnormal flag. Reporting this as clean would make a
    // vanishing app indistinguishable from a well-behaved one.
    const fake = makeFakeConnector({ autoUpgrade: true });
    const got = collector();
    const dialed = await dialPeer(4008, got, { connector: fake.connector, limits: { closeHandshakeMs: 5000 } });
    expect(dialed.ok).toBe(true);
    live!.sendClose(1001, "going away", "browser left");
    // No close frame back — the socket just dies.
    fake.close();
    expect(got.closes.length).toBe(1);
    expect(got.closes[0]).toEqual({ code: 1001, reason: "going away", abnormal: true, detail: "browser left; socket closed before the close handshake completed" });
    await Bun.sleep(60);
    expect(got.closes.length).toBe(1);
  });

  it("gets the close echo OUT to a blocked peer before ending the socket", async () => {
    // The close-handshake contract, in the one condition where it is hard: the
    // app's close arrives while the socket is not draining, so the echo cannot go
    // out immediately. Finalizing straight away would clear the queue and end
    // TCP, dropping the echo exactly when the queue machinery is what matters.
    //
    // The fake socket makes this deterministic: writes are refused, an app close
    // is injected, then writes are allowed and drain fires.
    const fake = makeFakeConnector({ autoUpgrade: true });
    const got = collector();
    const dialed = await dialPeer(4003, got, { connector: fake.connector, limits: { closeHandshakeMs: 5000 } });
    expect(dialed.ok).toBe(true);
    const afterRequest = fake.writtenBytes().length;
    // The socket stops accepting anything.
    fake.socket.accept = 0;
    fake.data(APP_CLOSE_1001_AWAY);
    // Nothing could be written, so the connection must NOT have finalized yet.
    expect(fake.writtenBytes().length).toBe(afterRequest);
    expect(got.closes).toEqual([]);
    expect(fake.socket.ended).toBe(false);
    // Now the socket drains.
    fake.socket.accept = -1;
    fake.drain();
    // The echo went out — a close frame carrying the same code — and only then did
    // the connection end.
    const tail = fake.writtenBytes().subarray(afterRequest);
    expect(tail.length).toBeGreaterThan(0);
    expect(tail[0] & 0x0f).toBe(0x8); // close opcode
    expect(got.closes.length).toBe(1);
    expect(got.closes[0]).toEqual({ code: 1001, reason: "away", abnormal: false, detail: null });
    expect(fake.socket.ended).toBe(true);
  });

  it("calls it abnormal when the socket dies before the echo could be sent", async () => {
    // The mirror of the resume-and-drain case: the app's close arrived, our echo
    // was queued, and the transport died before those bytes could leave. The
    // handshake did NOT complete, so the peer's code and reason are kept but the
    // event is abnormal — otherwise a peer that vanishes mid-goodbye is
    // indistinguishable from one that completed the exchange.
    const fake = makeFakeConnector({ autoUpgrade: true });
    const got = collector();
    await dialPeer(4009, got, { connector: fake.connector, limits: { closeHandshakeMs: 5000 } });
    fake.socket.accept = 0;
    fake.data(APP_CLOSE_1001_AWAY);
    expect(got.closes).toEqual([]);
    // The socket dies before any drain.
    fake.close();
    expect(got.closes.length).toBe(1);
    expect(got.closes[0]).toEqual({ code: 1001, reason: "away", abnormal: true, detail: "socket closed before the close echo was sent" });
    await Bun.sleep(60);
    expect(got.closes.length).toBe(1);
  });

  it("treats a socket error the same way as a socket close, at every stage", async () => {
    // Both signals mean "the transport is gone", and they must not drift into
    // disagreeing about what a half-finished close was. The table covers the three
    // lifecycle positions an error can arrive in.
    const cases: { what: string; act: (fake: ReturnType<typeof makeFakeConnector>) => void; expected: (detail: string) => UpstreamCloseEvent }[] = [
      {
        what: "nothing in flight",
        act: () => undefined,
        expected: (detail) => ({ code: null, reason: "", abnormal: true, detail: `${detail} without a close frame` }),
      },
      {
        what: "our own close pending",
        act: () => live!.sendClose(1001, "going away", "browser left"),
        expected: (detail) => ({ code: 1001, reason: "going away", abnormal: true, detail: `browser left; ${detail} before the close handshake completed` }),
      },
      {
        what: "an echo owed to the app",
        act: (fake) => {
          fake.socket.accept = 0;
          fake.data(APP_CLOSE_1001_AWAY);
        },
        expected: (detail) => ({ code: 1001, reason: "away", abnormal: true, detail: `${detail} before the close echo was sent` }),
      },
    ];
    let port = 4100;
    for (const c of cases) {
      const fake = makeFakeConnector({ autoUpgrade: true });
      const got = collector();
      await dialPeer(port++, got, { connector: fake.connector, limits: { closeHandshakeMs: 5000 } });
      c.act(fake);
      fake.errorNow(new Error("EPIPE"));
      expect({ what: c.what, events: got.closes }).toEqual({ what: c.what, events: [c.expected("socket error: Error: EPIPE")] });
      live = null;
    }
  });

  it("still ends the socket if the echo can never be written", async () => {
    // The other half: the flush may never happen. The close timer is the bound,
    // and it reports the app's own code with the abnormal flag set, because no
    // complete close handshake happened.
    const fake = makeFakeConnector({ autoUpgrade: true });
    const got = collector();
    await dialPeer(4004, got, { connector: fake.connector, limits: { closeHandshakeMs: 60 } });
    fake.socket.accept = 0;
    fake.data(APP_CLOSE_1001_AWAY);
    expect(got.closes).toEqual([]);
    await Bun.sleep(150);
    expect(got.closes.length).toBe(1);
    expect(got.closes[0].code).toBe(1001);
    expect(got.closes[0].abnormal).toBe(true);
    expect(got.closes[0].detail).toContain("close handshake timed out");
  });

  it("reports a socket that dies mid-connection as abnormal, once", async () => {
    peer = startPeer({});
    const got = collector();
    await dialPeer(peer.port, got);
    peer.stop(true);
    peer = null;
    await until(() => got.closes.length > 0, "the abnormal close");
    expect(got.closes.length).toBe(1);
    expect(got.closes[0]).toEqual({ code: null, reason: "", abnormal: true, detail: "socket closed without a close frame" });
    // Every later call is inert rather than a second close.
    live!.terminate("again");
    live!.sendClose(1000, "again");
    expect(got.closes.length).toBe(1);
  });

  it("ends the connection when the app sends a protocol violation", async () => {
    peer = startPeer({
      onUpgraded(socket) {
        // A masked server frame: only a client may mask.
        socket.write(Buffer.from([0x81, 0x81, 1, 2, 3, 4, 0x60]));
      },
    });
    const got = collector();
    await dialPeer(peer.port, got, { limits: { closeHandshakeMs: 100 } });
    await until(() => got.closes.length > 0, "the protocol-error close");
    expect(got.closes.length).toBe(1);
    expect(got.closes[0].code).toBe(1002);
    expect(got.closes[0].detail).toContain("protocol error");
  });
});
