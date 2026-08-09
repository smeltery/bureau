// Backpressure, revocation, and the rule that binds them: a fault the RELAY
// diagnosed reaches BOTH ends the same way.
//
// The defect this file exists for: the relay used to tell the browser the right
// code and tell the app a flat 1001 "going away" — so an app whose client sent an
// oversized message learned that the office was shutting down. Every case here
// asserts the APP's own close event, not just the browser's.

import { afterEach, describe, expect, it } from "bun:test";
import { _testResetWsRelay, _testWsSocketsOpen } from "../host/ws-relay-permits.ts";
import { appSeen, portOf, startApp, until } from "./host-ws-kit.ts";
import { appRecord, openRelay, registryOf, resetAppSessions, signIn, signOut, unreadableRegistry } from "./host-ws-relay-kit.ts";

const stoppers: Array<() => void> = [];

afterEach(async () => {
  while (stoppers.length > 0) stoppers.pop()!();
  await Bun.sleep(80);
  _testResetWsRelay();
  resetAppSessions();
});

// A real echo app that RECORDS THE CLOSES IT SEES. That recording is the point: a
// test that only watches the browser leg passes while the app is being told
// something else entirely.
function echoApp() {
  const seen = appSeen();
  const app = startApp(seen);
  stoppers.push(() => void app.stop(true));
  const record = appRecord({ port: portOf(app) });
  return { seen, record, cookie: signIn(record) };
}

describe("host-ws-relay: backpressure on the browser leg", () => {
  it("closes 1011 rather than handing the runtime more than the ceiling, and tells the app so", async () => {
    const { seen, record, cookie } = echoApp();
    const result = await openRelay(record, cookie, { bufferMaxBytes: 4096 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const { relay, browser } = result.opened;
    // The runtime says it is holding almost the whole ceiling already.
    browser.buffered = 4000;
    relay.onUpstreamMessage({ kind: "text", text: "x".repeat(200) });
    // Checked BEFORE the send, so the message never reached the runtime at all.
    expect(browser.sent).toEqual([]);
    expect(browser.closes).toEqual([{ code: 1011, reason: "browser stopped reading" }]);
    await until(() => seen.closes.length > 0, "the app's close");
    // 1011, not 1013: measured, Bun's server turns a peer close carrying
    // 1012-1014 or 3000-3999 into 1006 with no reason, so the semantically
    // perfect code is the one code that cannot be delivered here.
    expect(seen.closes[0]).toEqual({ code: 1011, reason: "browser stopped reading" });
    // Still occupied: asking a socket to close is not the same as it closing.
    expect(_testWsSocketsOpen().total).toBe(1);
    relay.browserClosed(1011, "browser stopped reading");
    await until(() => _testWsSocketsOpen().total === 0, "the permit to come back");
  });

  it("treats a dropped message as fatal, but not an empty one", async () => {
    const dropped = echoApp();
    const first = await openRelay(dropped.record, dropped.cookie);
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    // 0 from send() is Bun saying it DISCARDED the message (measured, past its own
    // backpressure limit). A relay that carries on has a hole in the stream.
    first.opened.browser.sendReturns = 0;
    first.opened.relay.onUpstreamMessage({ kind: "text", text: "lost" });
    expect(first.opened.browser.closes).toEqual([{ code: 1011, reason: "browser stopped reading" }]);

    const empty = await openRelay(dropped.record, dropped.cookie);
    expect(empty.ok).toBe(true);
    if (!empty.ok) return;
    // An EMPTY message also returns 0 and is not a drop. Without the size guard
    // this would kill every connection an app sends an empty frame on.
    empty.opened.browser.sendReturns = 0;
    empty.opened.relay.onUpstreamMessage({ kind: "text", text: "" });
    expect(empty.opened.browser.closes).toEqual([]);
  });

  it("closes 1009 for a message over the relay's message cap, and tells the app 1009", async () => {
    const { seen, record, cookie } = echoApp();
    const result = await openRelay(record, cookie, { upstreamLimits: { maxMessageBytes: 64 } });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    result.opened.relay.browserMessage("y".repeat(65));
    expect(result.opened.browser.closes).toEqual([{ code: 1009, reason: "message too large" }]);
    await until(() => seen.closes.length > 0, "the app's close");
    expect(seen.closes[0]).toEqual({ code: 1009, reason: "message too large" });
  });

  it("closes 1011 when the app stops reading, and the ceiling really refuses", async () => {
    const { record, cookie } = echoApp();
    const result = await openRelay(record, cookie, {
      // A queue too small to hold much: the data ceiling is queueMax minus the
      // control reserve, so a few hundred bytes fill it.
      upstreamLimits: { queueMaxBytes: 2048, controlReserveBytes: 1024 },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const { relay, browser } = result.opened;
    // BYTE-BUDGETED, and it THROWS if the ceiling never refuses: a mutation that
    // removes the cap turns this loop into an unbounded allocator otherwise, and
    // the budget is what makes the failure instant instead of an OOM.
    const chunk = "z".repeat(1000);
    let written = 0;
    while (browser.closes.length === 0) {
      relay.browserMessage(chunk);
      written += chunk.length;
      if (written > 5_000_000) {
        throw new Error("the upstream queue ceiling never refused a write");
      }
    }
    expect(browser.closes[0]).toEqual({ code: 1011, reason: "app stopped reading" });
  });
});

describe("host-ws-relay: a socket that is no longer allowed to exist", () => {
  it("closes 1008 when the app is deleted under it, and tells the app so", async () => {
    const { seen, record, cookie } = echoApp();
    // The registry no longer lists this issuance: the app was deleted, or its name
    // was re-registered into a new generation.
    const result = await openRelay(record, cookie, { recheckMs: 20, registry: registryOf() });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    await until(() => result.opened.browser.closes.length > 0, "the revocation close");
    expect(result.opened.browser.closes[0]).toEqual({ code: 1008, reason: "session ended" });
    await until(() => seen.closes.length > 0, "the app's close");
    expect(seen.closes[0]).toEqual({ code: 1008, reason: "session ended" });
    // The close was INITIATED, not completed: the browser leg has not reported
    // back, so the socket still exists and the slot is still occupied.
    expect(_testWsSocketsOpen().total).toBe(1);
    result.opened.relay.browserClosed(1008, "session ended");
    await until(() => _testWsSocketsOpen().total === 0, "the permit to come back");
  });

  it("does not close a healthy socket on its own timer", async () => {
    const { record, cookie } = echoApp();
    const result = await openRelay(record, cookie, { recheckMs: 20 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Several ticks with nothing wrong.
    await Bun.sleep(120);
    expect(result.opened.browser.closes).toEqual([]);
  });

  it("closes 1008 when the office session behind the app session is revoked", async () => {
    const { seen, record, cookie } = echoApp();
    const result = await openRelay(record, cookie, { recheckMs: 20 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Signing out kills the office session; the app session is bound to it by
    // hash, so it stops validating on the next tick.
    signOut();
    await until(() => result.opened.browser.closes.length > 0, "the revocation close");
    expect(result.opened.browser.closes[0].code).toBe(1008);
    await until(() => seen.closes.length > 0, "the app's close");
    expect(seen.closes[0]).toEqual({ code: 1008, reason: "session ended" });
  });

  it("fails closed on a registry it cannot read", async () => {
    // A registry that throws is not a yes. The socket goes, with the same code a
    // deleted app gets.
    const { record, cookie } = echoApp();
    const result = await openRelay(record, cookie, { recheckMs: 20, registry: unreadableRegistry() });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    await until(() => result.opened.browser.closes.length > 0, "the fail-closed close");
    expect(result.opened.browser.closes[0]).toEqual({ code: 1008, reason: "session ended" });
  });
});
