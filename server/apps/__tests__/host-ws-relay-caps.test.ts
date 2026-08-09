// The socket caps, and the invariant they rest on: the cap counts SOCKETS, not
// relay objects that have been asked to close.
//
// A permit released when a close is INITIATED would let a replacement take the
// slot while the old sockets are still physically up, and a repeated fault could
// then hold more than 64/32 real sockets under a cap of 64/32. Each case below
// occupies the only slot, initiates a close, proves a replacement is REFUSED
// while a leg has not reported, and then frees exactly one slot with the terminal
// callback.

import { afterEach, describe, expect, it } from "bun:test";
import { APP_BUSY_BODY } from "../host/responses.ts";
import { _testResetWsRelay, _testWsSocketsOpen } from "../host/ws-relay-permits.ts";
import { appSeen, portOf, startApp, startRawApp, until } from "./host-ws-kit.ts";
import { appRecord, fakeWs, openRelay, relayFor, resetAppSessions, signIn } from "./host-ws-relay-kit.ts";

const stoppers: Array<() => void> = [];

afterEach(async () => {
  while (stoppers.length > 0) stoppers.pop()!();
  // DRAIN BEFORE RESETTING: stopping the apps kills the upstream sockets, and each
  // of those releases its permit on a later turn. Resetting first would let those
  // releases land afterwards and drive the count negative, so the NEXT test's cap
  // would be wrong instead of this one's teardown.
  await Bun.sleep(80);
  _testResetWsRelay();
  resetAppSessions();
});

// A real echo app, and the record that points at it.
function echoApp(name = "hello") {
  const seen = appSeen();
  const app = startApp(seen);
  stoppers.push(() => void app.stop(true));
  const record = appRecord({ name, hostLabel: name, port: portOf(app) });
  return { seen, record, cookie: signIn(record) };
}

// An app that speaks the handshake by hand and then answers NOTHING — no echo of
// a close, no frames. It exists to hold the app leg physically open after the
// office has initiated a close, which is the window the socket cap has to keep
// counting through. A Bun app cannot do this: it answers a close immediately.
function silentApp(opts: Parameters<typeof startRawApp>[0] = {}) {
  const app = startRawApp(opts);
  stoppers.push(() => app.stop());
  const record = appRecord({ port: app.port });
  return { app, record, cookie: signIn(record) };
}

describe("host-ws-relay: the socket caps", () => {
  it("refuses past the per-app cap and frees the slot when a socket ends", async () => {
    const { record, cookie } = echoApp();
    const seams = { maxPerApp: 2, maxTotal: 8 };
    const first = await openRelay(record, cookie, seams);
    const second = await openRelay(record, cookie, seams);
    expect(first.ok && second.ok).toBe(true);
    expect(_testWsSocketsOpen()).toEqual({ total: 2, perApp: 2 });

    const third = await openRelay(record, cookie, seams);
    expect(third.ok).toBe(false);
    if (!third.ok) {
      expect(third.response.status).toBe(429);
      expect(await third.response.text()).toBe(APP_BUSY_BODY);
    }
    // The refusal did not take a slot of its own.
    expect(_testWsSocketsOpen()).toEqual({ total: 2, perApp: 2 });

    if (first.ok) first.opened.relay.browserClosed(1000, "done");
    await until(() => _testWsSocketsOpen().total === 1, "one slot to come back");
    const fourth = await openRelay(record, cookie, seams);
    expect(fourth.ok).toBe(true);
  });

  it("refuses past the office-wide cap across different apps", async () => {
    const one = echoApp("hello");
    const two = echoApp("other");
    const seams = { maxPerApp: 8, maxTotal: 2 };
    expect((await openRelay(one.record, one.cookie, seams)).ok).toBe(true);
    expect((await openRelay(two.record, two.cookie, seams)).ok).toBe(true);
    // The pool is office-wide: a third socket is refused even though neither app
    // is anywhere near its own cap.
    const third = await openRelay(one.record, one.cookie, seams);
    expect(third.ok).toBe(false);
    if (!third.ok) expect(third.response.status).toBe(429);
  });

  // BOTH genuine terminal entry points, injected in the same tick, in both orders
  // of arrival.
  for (const first of ["upstream", "browser"] as const) {
    it(`releases exactly once when both legs die in the same tick (${first} first)`, async () => {
      const { record, cookie } = echoApp();
      const result = await openRelay(record, cookie, { maxTotal: 4 });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(_testWsSocketsOpen().total).toBe(1);
      const relay = result.opened.relay;
      const upstreamClose = () => relay.onUpstreamClose({ code: 1000, reason: "app done", abnormal: false, detail: null });
      const browserClose = () => relay.browserClosed(1006, "");
      if (first === "upstream") {
        upstreamClose();
        browserClose();
      } else {
        browserClose();
        upstreamClose();
      }
      // And a third signal for good measure: a relay that released per signal
      // would go negative here, and the NEXT test's cap would fail instead of
      // this one.
      relay.browserClosed(1000, "again");
      await until(() => _testWsSocketsOpen().total === 0, "the permit to come back");
      expect(_testWsSocketsOpen()).toEqual({ total: 0, perApp: 0 });
    });
  }
});

describe("host-ws-relay: the cap counts SOCKETS, not relay objects", () => {
  it("keeps the slot while the app leg has not ended (relay-diagnosed fault)", async () => {
    // Silent app: it will never answer our close, so the app leg stays up until
    // the close-handshake budget expires — a deterministic window.
    const { record, cookie } = silentApp();
    const seams = { maxPerApp: 1, bufferMaxBytes: 4096, upstreamLimits: { closeHandshakeMs: 400 } };
    const first = await openRelay(record, cookie, seams);
    expect(first.ok).toBe(true);
    if (!first.ok) return;

    first.opened.browser.buffered = 4000;
    first.opened.relay.onUpstreamMessage({ kind: "text", text: "x".repeat(200) });
    expect(first.opened.browser.closes[0].code).toBe(1011);

    // BOTH legs are still up. The slot is not free, and a replacement is refused
    // rather than admitted alongside two live sockets.
    expect(_testWsSocketsOpen()).toEqual({ total: 1, perApp: 1 });
    const denied = await openRelay(record, cookie, seams);
    expect(denied.ok).toBe(false);
    if (!denied.ok) expect(denied.response.status).toBe(429);

    // The browser leg reports first: still not free, because the app leg is up.
    first.opened.relay.browserClosed(1011, "browser stopped reading");
    expect(_testWsSocketsOpen().total).toBe(1);
    expect((await openRelay(record, cookie, seams)).ok).toBe(false);

    // Only when the app leg finally ends does the slot come back — exactly one.
    await until(() => _testWsSocketsOpen().total === 0, "the app leg to end", 4000);
    const replacement = await openRelay(record, cookie, seams);
    expect(replacement.ok).toBe(true);
    expect(_testWsSocketsOpen()).toEqual({ total: 1, perApp: 1 });
  });

  it("keeps the slot while the browser leg has not ended (app closed first)", async () => {
    // An app that closes the moment it connects: the app leg ends immediately and
    // the browser leg is the one still outstanding.
    const { record, cookie } = silentApp({ closeOnConnect: true });
    const seams = { maxPerApp: 1 };
    const first = await openRelay(record, cookie, seams);
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    // The app's own code reached the browser leg...
    await until(() => first.opened.browser.closes.length > 0, "the app's close");
    expect(first.opened.browser.closes[0]).toEqual({ code: 4001, reason: "app done" });
    // ...and that leg has not reported back, so the slot is still taken.
    expect(_testWsSocketsOpen().total).toBe(1);
    const denied = await openRelay(record, cookie, seams);
    expect(denied.ok).toBe(false);
    if (!denied.ok) expect(denied.response.status).toBe(429);

    first.opened.relay.browserClosed(4001, "app done");
    await until(() => _testWsSocketsOpen().total === 0, "the permit to come back");
    // Exactly one slot came back, not two.
    expect(_testWsSocketsOpen()).toEqual({ total: 0, perApp: 0 });
    expect((await openRelay(record, cookie, seams)).ok).toBe(true);
  });

  it("keeps the slot when the runtime attaches SYNCHRONOUSLY inside upgrade()", async () => {
    // The sharpest case, and it only exists because of a measured Bun behavior:
    // `server.upgrade()` runs the socket's `open` handler INSIDE the call. With an
    // app that closes before the upgrade, that means attachBrowser applies the
    // recorded close and finishes the relay while upgrade() has not yet returned.
    // If the browser leg were marked live only AFTER the call, that finish would
    // see no browser leg, hand the permit back while the browser's close handshake
    // was still live, and set the flag on a leg that no longer had a permit behind
    // it.
    const { record, cookie } = silentApp({ closeOnConnect: true });
    const browser = fakeWs();
    const captured = await relayFor(record, cookie, {
      maxPerApp: 1,
      upgrade: (_req, data) => {
        // Synchronously, before returning — what Bun does.
        data.relay.attachBrowser(browser.ws);
        return true;
      },
    });
    expect(captured.ok).toBe(true);
    if (!captured.ok) return;
    // The app's own close reached the browser leg...
    expect(browser.closes[0]).toEqual({ code: 4001, reason: "app done" });
    // ...and that leg has NOT reported back, so the slot is still occupied and a
    // replacement is refused.
    expect(_testWsSocketsOpen()).toEqual({ total: 1, perApp: 1 });
    const denied = await openRelay(record, cookie, { maxPerApp: 1 });
    expect(denied.ok).toBe(false);
    if (!denied.ok) expect(denied.response.status).toBe(429);
    // Only the real close callback frees it, and exactly once.
    captured.relay.browserClosed(4001, "app done");
    await until(() => _testWsSocketsOpen().total === 0, "the permit to come back");
    expect(_testWsSocketsOpen()).toEqual({ total: 0, perApp: 0 });
  });

  it("frees nothing at all while a browser-initiated close is in flight", async () => {
    const { record, cookie } = silentApp();
    const seams = { maxPerApp: 1, upstreamLimits: { closeHandshakeMs: 400 } };
    const first = await openRelay(record, cookie, seams);
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    // The browser hangs up. Its leg is gone, but the app leg is mid-close.
    first.opened.relay.browserClosed(1000, "bye");
    expect(_testWsSocketsOpen().total).toBe(1);
    expect((await openRelay(record, cookie, seams)).ok).toBe(false);
    await until(() => _testWsSocketsOpen().total === 0, "the app leg to end", 4000);
  });
});

describe("host-ws-relay: the window before the socket opens", () => {
  it("refuses BEFORE the upgrade when the app floods the pre-open buffer", async () => {
    // An app that writes its 101 AND a data frame in ONE write, so the frame
    // shares the TCP read that ends the handshake. That is what makes this
    // deterministic rather than a race: the upstream client hands those leftover
    // bytes to the connection inside begin(), which runs BEFORE the dial's promise
    // continuation — so they are guaranteed to arrive while no relay object exists.
    //
    // 2KB of payload against a 1KB ceiling. The close-handshake budget is seamed
    // short because this app never answers a close.
    const { app, record, cookie } = silentApp({ greetBytes: 2048 });
    const result = await openRelay(record, cookie, { bufferMaxBytes: 1024, upstreamLimits: { closeHandshakeMs: 200 } });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      // 503, NOT the cap's 429 — the two share a body and differ only by status,
      // so both are pinned here, together, where the distinction is visible.
      expect({ status: result.response.status, body: await result.response.text() }).toEqual({ status: 503, body: APP_BUSY_BODY });
    }
    // No socket was opened and the connection to the app was closed rather than
    // left holding bytes nobody will read — but the slot stays occupied until that
    // connection has actually ended, which for an app that never answers a close
    // is the close-handshake budget.
    expect(_testWsSocketsOpen().total).toBe(1);
    await until(() => app.ended() > 0, "the app's socket to end", 4000);
    await until(() => _testWsSocketsOpen().total === 0, "the permit to come back", 4000);
  });

  it("releases exactly once when the browser vanishes before it ever opens", async () => {
    // Measured on Bun 1.3.11: `open` fires SYNCHRONOUSLY inside server.upgrade()
    // and fires even for a socket that has already been reset (observed order:
    // open -> upgrade() returns -> close(1006)). So a stranded permit is not
    // reachable through the runtime. This drives the defensive path anyway — a
    // relay that was upgraded and never attached — because the day that ordering
    // changes, this is the accounting that would silently drift.
    const { record, cookie } = echoApp();
    const captured = await relayFor(record, cookie);
    expect(captured.ok).toBe(true);
    if (!captured.ok) return;
    expect(_testWsSocketsOpen().total).toBe(1);
    // No attachBrowser: the socket died between the 101 and the callback.
    captured.relay.browserClosed(1006, "");
    await until(() => _testWsSocketsOpen().total === 0, "the permit to come back");
    // And a second terminal signal on the same relay does not double-release.
    captured.relay.browserClosed(1000, "again");
    expect(_testWsSocketsOpen()).toEqual({ total: 0, perApp: 0 });
  });
});
