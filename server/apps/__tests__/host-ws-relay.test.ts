// The relay carrying frames, mapping closes, and negotiating a subprotocol.
//
// Two independent implementations sit on the two legs — a fake browser socket
// standing in for Bun's server WebSocket, and the office's in-house client facing
// a real Bun app — which is what makes an echo here mean something rather than a
// codec agreeing with itself. The app leg is real in every test; only the browser
// leg is faked, because the office is what would supply it.

import { afterEach, describe, expect, it } from "bun:test";
import { APP_WS_UPGRADE_FAILED_BODY, APP_WS_PROTOCOL_MISMATCH_BODY } from "../host/responses.ts";
import { appRelaySocketMessage, closeAppRelaySocket, isAppRelaySocket, openAppRelaySocket, relayWsToApp, type AppRelayWsData } from "../host/ws-relay.ts";
import { _testResetWsRelay, _testWsSocketsOpen } from "../host/ws-relay-permits.ts";
import { appSeen, portOf, startApp, startRawApp, until } from "./host-ws-kit.ts";
import { RUNNING, appHostOf, appRecord, fakeWs, openRelay, registryOf, relayFor, resetAppSessions, signIn, supervisorSaying, upgradeRequest } from "./host-ws-relay-kit.ts";

let app: ReturnType<typeof startApp> | null = null;
let raw: ReturnType<typeof startRawApp> | null = null;

afterEach(async () => {
  void app?.stop(true);
  app = null;
  raw?.stop();
  raw = null;
  // DRAIN BEFORE RESETTING, in that order. Stopping the app kills the upstream
  // sockets, and each of those releases its permit on a later turn; resetting the
  // counters first would let those releases land afterwards and drive the count
  // negative, so the next test's cap would be wrong instead of this one's
  // teardown being wrong.
  await Bun.sleep(50);
  _testResetWsRelay();
  resetAppSessions();
});

describe("host-ws-relay: frames both ways", () => {
  it("relays text and binary in both directions", async () => {
    const seen = appSeen();
    app = startApp(seen);
    const record = appRecord({ port: portOf(app) });
    const cookie = signIn(record);
    const result = await openRelay(record, cookie);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const { relay, browser } = result.opened;
    relay.browserMessage("hello app");
    await until(() => browser.sent.length > 0, "the text echo");
    expect(browser.sent[0]).toBe("echo:hello app");
    relay.browserMessage(Buffer.from([1, 2, 3]));
    await until(() => browser.sent.length > 1, "the binary echo");
    expect(Buffer.from(browser.sent[1] as Buffer)).toEqual(Buffer.from([1, 2, 3]));
    // The app saw exactly what the browser sent.
    expect(seen.frames).toEqual(["hello app", "binary:010203"]);
    // One socket, accounted for — and released when it goes.
    expect(_testWsSocketsOpen()).toEqual({ total: 1, perApp: 1 });
    relay.browserClosed(1000, "done");
    await until(() => _testWsSocketsOpen().total === 0, "the permit to come back");
  });

  it("carries the app's own close code and reason to the client", async () => {
    // The window the whole state machine exists for: the app is dialed before the
    // browser leg exists, so it can close with 4001 before there is anywhere to
    // put it. Answering 502 would throw away the one thing the app was saying.
    raw = startRawApp({ closeOnConnect: true });
    const record = appRecord({ port: raw.port });
    const cookie = signIn(record);
    const result = await openRelay(record, cookie);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    await until(() => result.opened.browser.closes.length > 0, "the app's close");
    expect(result.opened.browser.closes[0]).toEqual({ code: 4001, reason: "app done" });
  });

  it("delivers a message the app sent before the socket opened, and THEN its close", async () => {
    // The greeting must not be lost to the goodbye: a close that overtook the
    // app's last message would drop it silently, and "the app greeted me and hung
    // up" is a real protocol.
    raw = startRawApp({ greetBytes: 8, closeOnConnect: true });
    const record = appRecord({ port: raw.port });
    const cookie = signIn(record);
    const result = await openRelay(record, cookie);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    await until(() => result.opened.browser.closes.length > 0, "the app's close");
    expect(result.opened.browser.sent).toEqual(["a".repeat(8)]);
    expect(result.opened.browser.closes[0]).toEqual({ code: 4001, reason: "app done" });
  });

  it("maps a status-less close to a clean 1000, never to a drop", async () => {
    // An app can close with a close FRAME carrying no status code. Bun's server
    // API cannot express that downstream (ws.close() puts 1000 on the wire —
    // measured), so the relay chooses between inventing 1000 and reporting 1006.
    // It invents 1000: the app closed CLEANLY, and 1006 is what every reconnect
    // loop treats as a failure.
    raw = startRawApp({ closeWithNoStatus: true });
    const record = appRecord({ port: raw.port });
    const cookie = signIn(record);
    const result = await openRelay(record, cookie);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    await until(() => result.opened.browser.closes.length > 0, "the app's close");
    expect(result.opened.browser.closes[0]).toEqual({ code: 1000, reason: "" });
    expect(result.opened.browser.terminated).toBe(0);
  });

  it("tells the client the truth when the app's connection drops", async () => {
    // No close frame was exchanged, so none is invented: the browser sees its
    // socket end, which is what 1006 means.
    const seen = appSeen();
    app = startApp(seen);
    const record = appRecord({ port: portOf(app) });
    const cookie = signIn(record);
    const result = await openRelay(record, cookie);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    void app.stop(true);
    app = null;
    await until(() => result.opened.browser.terminated > 0, "the browser leg to be dropped");
    expect(result.opened.browser.closes).toEqual([]);
  });

  it("carries the client's close code and reason to the app, and a drop as a drop", async () => {
    for (const [code, expected] of [
      [4002, { code: 4002, reason: "client done" }],
      [1006, { code: 1006, reason: "" }],
    ] as const) {
      const seen = appSeen();
      const running = startApp(seen);
      const record = appRecord({ port: portOf(running) });
      const cookie = signIn(record);
      const result = await openRelay(record, cookie);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      result.opened.relay.browserClosed(code, code === 1006 ? "" : "client done");
      await until(() => seen.closes.length > 0, `the app's close for ${code}`);
      expect(seen.closes[0]).toEqual(expected);
      void running.stop(true);
      await until(() => _testWsSocketsOpen().total === 0, "the permit to come back");
    }
  });
});

describe("host-ws-relay: subprotocol negotiation", () => {
  it("relays the app's selection exactly, not the runtime's guess", async () => {
    // The app selects the SECOND offered protocol, deliberately. Bun's own answer,
    // if the relay did not set the header itself, is the FIRST offered (measured)
    // — so an app that picks the first would let a broken relay pass this test.
    raw = startRawApp({ protocolLine: (offered) => (offered?.includes("superchat") ? "superchat" : null) });
    const record = appRecord({ port: raw.port });
    const cookie = signIn(record);
    let answered: Headers | undefined;
    const response = await relayWsToApp(upgradeRequest(record, cookie, { protocols: "chat, superchat" }), {
      app: record,
      host: appHostOf(record),
      apps: [record],
      supervisor: supervisorSaying({ [record.name]: RUNNING }),
      registry: registryOf(record),
      upgrade: (_req, _data, headers) => {
        answered = headers;
        return true;
      },
    });
    expect(response).toBeUndefined();
    // The header rides the 101, because without it the runtime answers for
    // itself and the two legs disagree about the application protocol.
    expect(answered?.get("Sec-WebSocket-Protocol")).toBe("superchat");
  });

  it("passes the client's offer through to the app untouched", async () => {
    const seen = appSeen();
    app = startApp(seen);
    const record = appRecord({ port: portOf(app) });
    const cookie = signIn(record);
    const result = await openRelay(record, cookie, {}, { protocols: "chat, superchat" });
    expect(result.ok).toBe(true);
    expect(seen.upgradeHeaders[0]["sec-websocket-protocol"]).toBe("chat, superchat");
  });

  it("refuses when the app selects none of the offered protocols", async () => {
    // Refused rather than relayed, because a browser fails a connection itself
    // when its offer is not acknowledged (WHATWG 2.2 step 11.2) — so relaying it
    // would make the hostname succeed where the app's own port fails, with the
    // two ends disagreeing about the protocol.
    raw = startRawApp({ protocolLine: () => null });
    const record = appRecord({ port: raw.port });
    const cookie = signIn(record);
    const result = await openRelay(record, cookie, {}, { protocols: "chat" });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect({ status: result.response.status, body: await result.response.text() }).toEqual({ status: 502, body: APP_WS_PROTOCOL_MISMATCH_BODY });
    }
    // The socket to the app was ended here rather than left for a finalizer that
    // does not exist yet, so the slot comes back.
    await until(() => _testWsSocketsOpen().total === 0, "the permit to come back");
  });

  it("refuses when the app selects a protocol nobody offered", async () => {
    raw = startRawApp({ protocolLine: () => "something-else" });
    const record = appRecord({ port: raw.port });
    const cookie = signIn(record);
    const result = await openRelay(record, cookie, {}, { protocols: "chat" });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect({ status: result.response.status, body: await result.response.text() }).toEqual({ status: 502, body: APP_WS_PROTOCOL_MISMATCH_BODY });
    }
  });

  it("answers with no protocol header when none was offered", async () => {
    const seen = appSeen();
    app = startApp(seen);
    const record = appRecord({ port: portOf(app) });
    const cookie = signIn(record);
    let answered: Headers | undefined = new Headers();
    const response = await relayWsToApp(upgradeRequest(record, cookie), {
      app: record,
      host: appHostOf(record),
      apps: [record],
      supervisor: supervisorSaying({ [record.name]: RUNNING }),
      registry: registryOf(record),
      upgrade: (_req, _data, headers) => {
        answered = headers;
        return true;
      },
    });
    expect(response).toBeUndefined();
    expect(answered).toBeUndefined();
  });
});

describe("host-ws-relay: the callbacks the office routes to", () => {
  it("tells an app-relay socket apart from the office's own, and routes all three callbacks", async () => {
    // One Bun.serve serves the office and every app host, so its three websocket
    // callbacks receive both kinds of socket. Nothing of the office's machinery may
    // run for a relayed one, and nothing here may run for an office one.
    expect(isAppRelaySocket({ kind: "app", relay: null })).toBe(true);
    // The office's own WsData carries a session and no `kind` at all.
    expect(isAppRelaySocket({ session: null })).toBe(false);
    expect(isAppRelaySocket({ kind: "office", session: null })).toBe(false);
    expect(isAppRelaySocket(null)).toBe(false);
    expect(isAppRelaySocket("app")).toBe(false);

    const seen = appSeen();
    app = startApp(seen);
    const record = appRecord({ port: portOf(app) });
    const cookie = signIn(record);
    const captured = await relayFor(record, cookie);
    expect(captured.ok).toBe(true);
    if (!captured.ok) return;
    const browser = fakeWs();
    // `open` attaches the browser leg, `message` carries a frame up to the app,
    // `close` ends the relay — each through the socket's own data, never a lookup.
    const ws = Object.assign(browser.ws, { data: { kind: "app", relay: captured.relay } as AppRelayWsData });
    openAppRelaySocket(ws);
    appRelaySocketMessage(ws, "through the office");
    await until(() => browser.sent.length > 0, "the echo");
    expect(browser.sent[0]).toBe("echo:through the office");
    appRelaySocketMessage(ws, Buffer.from([9]));
    await until(() => seen.frames.length > 1, "the binary frame");
    expect(seen.frames).toEqual(["through the office", "binary:09"]);
    closeAppRelaySocket(ws, 1001, "tab closed");
    await until(() => seen.closes.length > 0, "the app's close");
    expect(seen.closes[0]).toEqual({ code: 1001, reason: "tab closed" });
    await until(() => _testWsSocketsOpen().total === 0, "the permit to come back");
  });
});

describe("host-ws-relay: the runtime seam", () => {
  it("holds nothing when the runtime refuses the upgrade, and nothing when it throws", async () => {
    const seen = appSeen();
    app = startApp(seen);
    const record = appRecord({ port: portOf(app) });
    const cookie = signIn(record);
    for (const mode of ["refuse", "throw"] as const) {
      const response = await relayWsToApp(upgradeRequest(record, cookie), {
        app: record,
        host: appHostOf(record),
        apps: [record],
        supervisor: supervisorSaying({ [record.name]: RUNNING }),
        registry: registryOf(record),
        upgrade: () => {
          if (mode === "throw") throw new Error("runtime seam blew up");
          return false;
        },
      });
      expect(response).toBeDefined();
      expect(response!.status).toBe(500);
      expect(await response!.text()).toBe(APP_WS_UPGRADE_FAILED_BODY);
      // There is no browser leg, so the slot comes back as soon as the app leg
      // ends — and it must come back, including through the throwing seam.
      await until(() => _testWsSocketsOpen().total === 0, `the permit after ${mode}`, 4000);
    }
  });
});
