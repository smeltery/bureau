// What never reaches the app, and in what order it is refused.
//
// Every test here asserts on the app's own record of what it was asked — `seen`
// staying empty is the assertion that carries most of them. A refusal that
// happens after a dial is not the same refusal, even when the status matches:
// the app has already been connected to.

import { afterEach, describe, expect, it } from "bun:test";
import { APP_COOKIE_NAME } from "../host/auth-cookie.ts";
import { APP_STOPPED_BODY, APP_WS_BAD_ORIGIN_BODY, BAD_REQUEST_BODY } from "../host/responses.ts";
import { APP_WS_MAX_PROTOCOL_HEADER_BYTES } from "../host/ws-relay-rules.ts";
import { _testResetWsRelay, _testWsSocketsOpen } from "../host/ws-relay-permits.ts";
import { COOKIE_NAME, HOST_COOKIE_NAME } from "../../auth/http-env.ts";
import { appSeen, portOf, startApp, until } from "./host-ws-kit.ts";
import { appHostOf, appRecord, openRelay, resetAppSessions, signIn, supervisorSaying } from "./host-ws-relay-kit.ts";

let app: ReturnType<typeof startApp> | null = null;

afterEach(async () => {
  void app?.stop(true);
  app = null;
  await Bun.sleep(50);
  _testResetWsRelay();
  resetAppSessions();
});

describe("host-ws-relay: what never reaches the app", () => {
  it("refuses an upgrade whose Origin is not the app's own, and allows none", async () => {
    // A browser can be made to open a WebSocket cross-site, and the app is not
    // the one that gets to decide about that. Cheap, and it fails a cross-origin
    // attempt before the app hears about it at all.
    const seen = appSeen();
    app = startApp(seen);
    const record = appRecord({ port: portOf(app) });
    const host = appHostOf(record);
    const cookie = signIn(record);
    for (const origin of ["https://evil.test", `http://${host}`, "https://office.example", `https://${host}:443`]) {
      const result = await openRelay(record, cookie, {}, { origin });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect({ origin, status: result.response.status, body: await result.response.text() }).toEqual({ origin, status: 403, body: APP_WS_BAD_ORIGIN_BODY });
      }
    }
    expect(seen.upgradeHeaders).toEqual([]);
    expect(_testWsSocketsOpen().total).toBe(0);

    // The app's own origin passes, and so does no origin at all: a client that
    // sends none is not a browser, and has no ambient cookie to be abused.
    const good = await openRelay(record, cookie, {}, { origin: `https://${host}` });
    expect(good.ok).toBe(true);
    if (good.ok) good.opened.relay.browserClosed(1000, "done");
    const headless = await openRelay(record, cookie);
    expect(headless.ok).toBe(true);
    if (headless.ok) headless.opened.relay.browserClosed(1000, "done");
    await until(() => _testWsSocketsOpen().total === 0, "both permits to come back");
  });

  it("refuses a stopped app without dialing its port", async () => {
    // Something IS listening there — the point of the test. A stopped app's port
    // is just a free port, and whatever is on it is not the app. The supervisor is
    // the INJECTED one, never a production singleton reached for from inside.
    const seen = appSeen();
    app = startApp(seen);
    const record = appRecord({ port: portOf(app) });
    const cookie = signIn(record);
    for (const state of ["stopped", "failed", "starting", "unknown"] as const) {
      const result = await openRelay(record, cookie, { supervisor: supervisorSaying({ [record.name]: { state, restartCount: 0 } }) });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect({ state, status: result.response.status, body: await result.response.text() }).toEqual({ state, status: 503, body: APP_STOPPED_BODY });
      }
    }
    // An app the supervisor says nothing about at all is refused the same way.
    const missing = await openRelay(record, cookie, { supervisor: supervisorSaying({}) });
    expect(missing.ok).toBe(false);
    expect(seen.upgradeHeaders).toEqual([]);
    // A refusal takes no slot of its own, which is the accounting bug a cap
    // normally has: it refuses and leaks.
    expect(_testWsSocketsOpen().total).toBe(0);
  });

  it("refuses a malformed subprotocol offer without dialing the app", async () => {
    const seen = appSeen();
    app = startApp(seen);
    const record = appRecord({ port: portOf(app) });
    const cookie = signIn(record);
    // The oversized case is in this list deliberately: it is refused HERE, with a
    // 400 and no connection to the app, rather than being forwarded into the
    // upgrade request and refused by the request byte ceiling after a permit and a
    // dial. `seen` staying empty is the assertion that carries that.
    const oversized = "a".repeat(APP_WS_MAX_PROTOCOL_HEADER_BYTES + 1);
    for (const protocols of ["", "chat, chat", "not a token", "chat,,x", oversized]) {
      const result = await openRelay(record, cookie, {}, { protocols });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect({ protocols: protocols.slice(0, 20), status: result.response.status, body: await result.response.text() }).toEqual({
          protocols: protocols.slice(0, 20),
          status: 400,
          body: BAD_REQUEST_BODY,
        });
      }
    }
    expect(seen.upgradeHeaders).toEqual([]);
    expect(_testWsSocketsOpen().total).toBe(0);
  });

  it("strips every bureau credential and every client X-Forwarded-* from the upgrade it sends the app", async () => {
    // The app must never see what admits to it — nor a live office session, which
    // would let it act as that user against the office API — and a header the
    // relay owns is worthless if a client can pre-fill it.
    const seen = appSeen();
    app = startApp(seen);
    const record = appRecord({ port: portOf(app) });
    const host = appHostOf(record);
    const cookie = signIn(record);
    const result = await openRelay(
      record,
      cookie,
      {},
      {
        headers: {
          Cookie: `${APP_COOKIE_NAME}=${cookie}; ${HOST_COOKIE_NAME}=STOLEN; ${COOKIE_NAME}=ALSO-STOLEN; app_pref=blue`,
          "X-Forwarded-For": "203.0.113.9",
          "X-Forwarded-Proto": "http",
          "X-Forwarded-Host": "evil.example",
          Forwarded: "for=203.0.113.9",
        },
      },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const headers = seen.upgradeHeaders[0];
    expect(headers.cookie).toBe("app_pref=blue");
    expect(headers.host).toBe(host);
    // Written by the relay, not echoed: the arm only exists on an https office.
    expect(headers["x-forwarded-proto"]).toBe("https");
    expect(headers["x-forwarded-host"]).toBe(host);
    // No peer thunk in this context, so there is no address to report — and no
    // literal "unknown" sitting where one belongs. The client's own value is gone.
    expect(headers["x-forwarded-for"]).toBeUndefined();
    expect(headers.forwarded).toBeUndefined();
    expect(JSON.stringify(headers)).not.toContain(cookie);
    expect(JSON.stringify(headers)).not.toContain("STOLEN");
    result.opened.relay.browserClosed(1000, "done");
    await until(() => _testWsSocketsOpen().total === 0, "the permit to come back");
  });

  it("writes the peer the office saw as X-Forwarded-For, unwrapping the mapped form", async () => {
    // Bun reports a loopback peer on a dual-stack socket as `::ffff:127.0.0.1`,
    // which is the same address written a way most XFF parsers have never seen.
    const seen = appSeen();
    app = startApp(seen);
    const record = appRecord({ port: portOf(app) });
    const cookie = signIn(record);
    const result = await openRelay(record, cookie, { peer: () => "::ffff:127.0.0.1" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(seen.upgradeHeaders[0]["x-forwarded-for"]).toBe("127.0.0.1");
    result.opened.relay.browserClosed(1000, "done");
    await until(() => _testWsSocketsOpen().total === 0, "the permit to come back");
  });

  it("survives a peer thunk that throws, because a gone socket is not a failure", async () => {
    const seen = appSeen();
    app = startApp(seen);
    const record = appRecord({ port: portOf(app) });
    const cookie = signIn(record);
    const result = await openRelay(record, cookie, {
      peer: () => {
        throw new Error("socket already gone");
      },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(seen.upgradeHeaders[0]["x-forwarded-for"]).toBeUndefined();
    result.opened.relay.browserClosed(1000, "done");
    await until(() => _testWsSocketsOpen().total === 0, "the permit to come back");
  });
});
