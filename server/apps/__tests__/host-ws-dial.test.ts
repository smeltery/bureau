// What only a hand-written peer can do: every way an app can fail to complete an
// upgrade, and the two limits that bound the handshake itself.
//
// Every failure here happens BEFORE any 101 has gone to a browser, which is the
// whole point of dialing the app first: an unreachable app is a clean HTTP
// refusal rather than a socket that opens and dies a millisecond later.

import { afterEach, describe, expect, it } from "bun:test";
import type { TCPSocketListener } from "bun";
import { handshakeAccept } from "../host/ws-handshake.ts";
import type { AppUpstream } from "../host/ws-upstream.ts";
import { collector, defaultAccept, dial, makeFakeConnector, startPeer, until, upgradeHead } from "./host-ws-kit.ts";

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

describe("host-ws-dial: failures happen before any 101", () => {
  it("reports a refused connection", async () => {
    // Nothing listening: the ordinary "the app is not up" case. Port 1 is
    // privileged and never bound by a test.
    const got = collector();
    const res = await dialPeer(1, got);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.failure).toBe("connect_failed");
    expect(got.closes).toEqual([]);
  });

  it("reports an app that answers with a page instead of an upgrade", async () => {
    peer = startPeer({ respond: () => "HTTP/1.1 200 OK\r\nContent-Type: text/html\r\nContent-Length: 5\r\n\r\nhello" });
    const res = await dialPeer(peer.port, collector());
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.failure).toBe("handshake_rejected");
  });

  it("reports an app whose accept value is wrong", async () => {
    // A cached or cross-wired response must not be taken for an open socket.
    peer = startPeer({ accept: () => "bm90LXJpZ2h0" });
    const res = await dialPeer(peer.port, collector());
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.failure).toBe("handshake_invalid");
      expect(res.detail).toContain("Sec-WebSocket-Accept");
    }
  });

  it("reports an app that answers with an extension", async () => {
    peer = startPeer({ extraResponseHeaders: ["Sec-WebSocket-Extensions: permessage-deflate"] });
    const res = await dialPeer(peer.port, collector());
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.detail).toContain("unoffered extension");
  });

  it("reports a subprotocol nobody offered as its own failure", async () => {
    // The one dial failure the caller can act on: their own client asked for an
    // application protocol this app did not agree to.
    peer = startPeer({ extraResponseHeaders: ["Sec-WebSocket-Protocol: mystery"] });
    const res = await dialPeer(peer.port, collector(), { protocols: ["chat"] });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.failure).toBe("handshake_protocol");
  });

  it("gives up on an app that never answers", async () => {
    peer = startPeer({ respond: () => null });
    const res = await dialPeer(peer.port, collector(), { limits: { handshakeTimeoutMs: 120 } });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.failure).toBe("handshake_timeout");
  });

  it("gives up on an app that dribbles headers forever", async () => {
    peer = startPeer({
      // A response that starts but never ends. The byte ceiling is what stops
      // this, not the timeout.
      respond: () => `HTTP/1.1 101 Switching Protocols\r\nX-Pad: ${"p".repeat(4000)}\r\n`,
    });
    const res = await dialPeer(peer.port, collector(), { limits: { handshakeMaxHeaderBytes: 1024, handshakeTimeoutMs: 5000 } });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.detail).toContain("byte ceiling");
  });

  it("reports an app that hangs up mid-handshake", async () => {
    peer = startPeer({ respond: () => "HTTP/1.1 101 Switching Protocols\r\nUpgrade: web", onUpgraded: () => {} });
    // The peer above writes a partial header block; close it from under the
    // client by stopping the listener.
    const got = collector();
    const dialing = dialPeer(peer.port, got, { limits: { handshakeTimeoutMs: 400 } });
    await Bun.sleep(60);
    peer.stop(true);
    peer = null;
    const res = await dialing;
    expect(res.ok).toBe(false);
    if (!res.ok) expect(["handshake_invalid", "handshake_timeout"]).toContain(res.failure);
    // No close event: nothing was ever open to close.
    expect(got.closes).toEqual([]);
  });
});

describe("host-ws-dial: the handshake's own limits", () => {
  it("refuses a complete but oversized header block in one read", async () => {
    // The ceiling is on the HEADER BLOCK, not on how long we waited for a
    // terminator: one read carrying 20KB of headers AND their terminator is over
    // the limit, and checking only the unterminated case would let it through and
    // then parse it.
    const accept = handshakeAccept("K");
    const oversized = ["HTTP/1.1 101 Switching Protocols", "Upgrade: websocket", "Connection: Upgrade", `Sec-WebSocket-Accept: ${accept}`, `X-Pad: ${"p".repeat(20 * 1024)}`, "", ""].join("\r\n");
    peer = startPeer({ respond: () => oversized });
    const res = await dialPeer(peer.port, collector(), { limits: { handshakeMaxHeaderBytes: 16 * 1024, handshakeTimeoutMs: 2000 } });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.detail).toContain("byte ceiling");
  });

  it("accepts a block UNDER the ceiling whose terminator splits a read", async () => {
    // The other side of the same check: the ceiling must not fire on a legitimate
    // block just because its terminator arrived in a later read. A cap that
    // rejects valid handshakes is worse than no cap.
    peer = startPeer({ respondBytes: (_request, accept) => upgradeHead(accept, [`X-Pad: ${"p".repeat(8 * 1024)}`]), splitLastByte: true });
    const res = await dialPeer(peer.port, collector(), { limits: { handshakeMaxHeaderBytes: 16 * 1024, handshakeTimeoutMs: 2000 } });
    expect(res.ok).toBe(true);
  });

  it("refuses to send an upgrade request over the request ceiling", async () => {
    // The headers in the request come from a browser. Their size is not ours to
    // assume, and a request too big to write is refused rather than half-sent.
    const res = await dialPeer(1, collector(), { headers: { "X-Big": "v".repeat(20 * 1024) }, limits: { handshakeMaxRequestBytes: 16 * 1024 } });
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.failure).toBe("bad_request");
      expect(res.detail).toContain("over the ceiling");
    }
  });

  it("bounds the WHOLE upgrade, including a connect that never completes", async () => {
    // The timer has to start before connect(), not in `open`: a connect that
    // never resolves has no handler to notice it. Only a fake connector can hold
    // a connect open indefinitely.
    const fake = makeFakeConnector({ neverConnect: true });
    const started = Date.now();
    const res = await dialPeer(4001, collector(), { connector: fake.connector, limits: { handshakeTimeoutMs: 120 } });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.failure).toBe("handshake_timeout");
    expect(Date.now() - started).toBeLessThan(2000);
  });

  it("writes the rest of the upgrade request when the socket only took part", async () => {
    // Raw TCP writes are partial — that is why this client exists — and a
    // truncated upgrade request would leave the app waiting for headers that
    // never come.
    const fake = makeFakeConnector({ accept: 20 });
    const dialing = dialPeer(4002, collector(), { connector: fake.connector, limits: { handshakeTimeoutMs: 400 } });
    // First write took 20 bytes; the tail waits for drain.
    expect(fake.writtenBytes().length).toBe(20);
    fake.socket.accept = -1;
    fake.drain();
    const written = fake.writtenBytes().toString();
    expect(written).toStartWith("GET /socket HTTP/1.1\r\n");
    expect(written).toEndWith("\r\n\r\n");
    expect(written).toContain("Sec-WebSocket-Key: ");
    // Let the dial settle so no promise is left dangling.
    fake.close();
    await dialing;
  });

  it("ignores a connect that completes after the dial gave up", async () => {
    // The timeout can fire before connect finishes. If `open` then arrives, the
    // request must NOT be written and a later 101 must not build a live
    // connection and start calling handlers for a caller who was already told the
    // dial failed.
    const fake = makeFakeConnector({ neverConnect: true, autoUpgrade: true });
    const got = collector();
    const res = await dialPeer(4005, got, { connector: fake.connector, limits: { handshakeTimeoutMs: 80 } });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.failure).toBe("handshake_timeout");
    // Connect completes late.
    fake.openLate();
    expect(fake.writtenBytes().length).toBe(0);
    expect(fake.socket.ended).toBe(true);
    // And even a syntactically perfect 101 afterwards changes nothing.
    fake.data(upgradeHead(defaultAccept("whatever")));
    await Bun.sleep(30);
    expect(got.messages).toEqual([]);
    expect(got.closes).toEqual([]);
  });

  it("refuses a response that arrives before the request has fully left", async () => {
    // A full-duplex peer sees the key long before the terminator, so it can
    // produce a valid-looking 101 while our request is still queued. Accepting it
    // would publish a connection and then write the tail of an HTTP request into
    // a WebSocket stream on the next drain.
    const fake = makeFakeConnector({ accept: 20 });
    const got = collector();
    const dialing = dialPeer(4006, got, { connector: fake.connector, limits: { handshakeTimeoutMs: 800 } });
    const afterFirstWrite = fake.writtenBytes().length;
    expect(afterFirstWrite).toBe(20);
    // The peer answers early, with an accept value it could not yet have computed
    // correctly — but even a correct one must be refused at this point.
    fake.data(upgradeHead(defaultAccept("early")));
    const res = await dialing;
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.failure).toBe("handshake_invalid");
      expect(res.detail).toContain("before the upgrade request");
    }
    // Nothing more of the HTTP request went out, and no connection was published.
    fake.socket.accept = -1;
    fake.drain();
    expect(fake.writtenBytes().length).toBe(afterFirstWrite);
    expect(got.messages).toEqual([]);
    expect(got.closes).toEqual([]);
  });

  it("keeps the specific outcome when the app closes in the same read as the 101", async () => {
    // A close frame riding the handshake's own read ends the connection
    // synchronously — which used to reach the socket's close handler before the
    // dial had published the connection, letting a generic "closed during the
    // upgrade" overwrite a handshake that had in fact succeeded.
    peer = startPeer({
      // ONE write: the 101 block and a close frame (1000 "done") together, so
      // they are guaranteed to reach the client in a single read.
      respondBytes: (_request, accept) => Buffer.concat([upgradeHead(accept), Buffer.from([0x88, 0x06, 0x03, 0xe8, 0x64, 0x6f, 0x6e, 0x65])]),
    });
    const got = collector();
    const res = await dialPeer(peer.port, got);
    expect(res.ok).toBe(true);
    await until(() => got.closes.length > 0, "the app's close");
    expect(got.closes[0].code).toBe(1000);
    expect(got.closes[0].reason).toBe("done");
    expect(got.closes[0].abnormal).toBe(false);
  });

  it("keeps the specific outcome when a violation rides the 101", async () => {
    peer = startPeer({
      // Again one write: the 101 plus a MASKED server frame, which only a client
      // may send.
      respondBytes: (_request, accept) => Buffer.concat([upgradeHead(accept), Buffer.from([0x81, 0x81, 1, 2, 3, 4, 0x60])]),
    });
    const got = collector();
    const res = await dialPeer(peer.port, got, { limits: { closeHandshakeMs: 100 } });
    // The handshake DID succeed; what follows is a connection that dies, and the
    // dial must say so rather than reporting an upgrade failure.
    expect(res.ok).toBe(true);
    await until(() => got.closes.length > 0, "the protocol-error close");
    expect(got.closes[0].code).toBe(1002);
  });
});
