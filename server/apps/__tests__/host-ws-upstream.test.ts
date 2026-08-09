// The upstream client against a REAL WebSocket app.
//
// Bun's own server implementation on the app leg, deliberately: the client leg is
// the office's own codec, so an echo here means the two agree about the wire
// rather than a codec agreeing with itself.

import { afterEach, describe, expect, it } from "bun:test";
import type { AppUpstream } from "../host/ws-upstream.ts";
import { appSeen, collector, dial, portOf, startApp, until } from "./host-ws-kit.ts";

let app: ReturnType<typeof startApp> | null = null;
let live: AppUpstream | null = null;

afterEach(() => {
  live?.terminate("test teardown");
  live = null;
  void app?.stop(true);
  app = null;
});

// Every test here dials the app it just started, and every dial that succeeds
// must be torn down — so the connection is captured in one place.
async function dialApp(port: number, got: ReturnType<typeof collector>, extra: Parameters<typeof dial>[2] = {}) {
  const result = await dial(port, got, extra);
  if (result.ok) live = result.connection;
  return result;
}

describe("host-ws-upstream: a real app", () => {
  it("carries text and binary both ways", async () => {
    const seen = appSeen();
    app = startApp(seen);
    const got = collector();
    const dialed = await dialApp(portOf(app), got);
    expect(dialed.ok).toBe(true);
    expect(live!.sendText("hello")).toBe("sent");
    expect(live!.sendBinary(Buffer.from([1, 2, 3]))).toBe("sent");
    await until(() => got.messages.length >= 2, "both echoes");
    expect(got.messages).toEqual([
      { kind: "text", body: "echo:hello" },
      { kind: "binary", body: "010203" },
    ]);
    // The app saw exactly what we sent, unmasked for it by its own runtime.
    expect(seen.frames).toEqual(["hello", "binary:010203"]);
  });

  it("sends the headers, Host and subprotocols it was given", async () => {
    const seen = appSeen();
    app = startApp(seen);
    const got = collector();
    const dialed = await dialApp(portOf(app), got, {
      target: "/socket?room=1",
      headers: { "X-Forwarded-For": "203.0.113.5", Cookie: "app_pref=blue" },
      protocols: ["graphql-ws"],
    });
    expect(dialed.ok).toBe(true);
    expect(live!.protocol).toBe("graphql-ws");
    const headers = seen.upgradeHeaders[0];
    expect(headers.host).toBe("hello.office.example");
    expect(headers["x-forwarded-for"]).toBe("203.0.113.5");
    expect(headers.cookie).toBe("app_pref=blue");
    expect(headers["sec-websocket-protocol"]).toBe("graphql-ws");
  });

  it("answers the app's ping with the same payload", async () => {
    // Nobody relays a ping: each leg answers its own, so an app's keepalive is
    // satisfied here rather than crossing to the browser.
    const seen = appSeen();
    app = startApp(seen);
    const got = collector();
    await dialApp(portOf(app), got);
    live!.sendText("ping-me");
    await until(() => seen.pongs.length > 0, "the pong");
    expect(seen.pongs).toEqual(["app-ping-payload"]);
    // And the ping never surfaced as a message.
    expect(got.messages).toEqual([]);
  });

  it("reports the app's close code and reason once", async () => {
    const seen = appSeen();
    app = startApp(seen);
    const got = collector();
    await dialApp(portOf(app), got);
    live!.sendText("close-4321");
    await until(() => got.closes.length > 0, "the close");
    expect(got.closes).toEqual([{ code: 4321, reason: "app said bye", abnormal: false, detail: null }]);
    // Sends after a close are refused rather than throwing: the relay's two legs
    // die in whichever order the network picks.
    expect(live!.sendText("late")).toBe("closing");
    await Bun.sleep(50);
    expect(got.closes.length).toBe(1);
  });

  it("reports a close with no status as a clean close", async () => {
    const seen = appSeen();
    app = startApp(seen);
    const got = collector();
    await dialApp(portOf(app), got);
    live!.sendText("close-plain");
    await until(() => got.closes.length > 0, "the close");
    // Measured: Bun's `ws.close()` with no arguments puts a close frame carrying
    // 1000 on the wire, so this is what a status-less server close looks like
    // from Bun.
    expect(got.closes[0].code).toBe(1000);
    expect(got.closes[0].abnormal).toBe(false);
  });

  it("carries our close code to the app", async () => {
    const seen = appSeen();
    app = startApp(seen);
    const got = collector();
    await dialApp(portOf(app), got);
    live!.sendClose(4001, "browser went away");
    await until(() => seen.closes.length > 0, "the app's close event");
    expect(seen.closes).toEqual([{ code: 4001, reason: "browser went away" }]);
  });

  it("terminates with no close frame, so the app sees an abnormal close", async () => {
    // This is the vocabulary for "the browser vanished": 1006 means exactly
    // "the connection dropped without a close frame", and the only way to say it
    // is to do it.
    const seen = appSeen();
    app = startApp(seen);
    const got = collector();
    await dialApp(portOf(app), got);
    live!.terminate("browser vanished");
    await until(() => seen.closes.length > 0, "the app's close event");
    expect(seen.closes).toEqual([{ code: 1006, reason: "" }]);
    expect(got.closes).toEqual([{ code: null, reason: "", abnormal: true, detail: "browser vanished" }]);
  });

  it("delivers a greeting that shared the handshake's read", async () => {
    // An app that speaks first puts its frame in the same TCP read as the end of
    // the response headers. Dropping those bytes would lose the only message a
    // server-greets protocol ever sends unprompted.
    const seen = appSeen();
    app = startApp(seen, { greet: "welcome" });
    const got = collector();
    await dialApp(portOf(app), got);
    await until(() => got.messages.length > 0, "the greeting");
    expect(got.messages).toEqual([{ kind: "text", body: "welcome" }]);
  });

  it("refuses a message over the cap in both directions", async () => {
    const seen = appSeen();
    app = startApp(seen);
    const got = collector();
    await dialApp(portOf(app), got, { limits: { maxMessageBytes: 1000 } });
    // Outbound: refused before a byte reaches the wire.
    expect(live!.sendText("x".repeat(1001))).toBe("too_large");
    expect(live!.sendBinary(Buffer.alloc(1001))).toBe("too_large");
    expect(seen.frames).toEqual([]);
    // Inbound: the app sends 5000 bytes, the connection ends with 1009.
    live!.sendText("big");
    await until(() => got.closes.length > 0, "the oversize close");
    expect(got.closes[0].code).toBe(1009);
    expect(got.closes[0].detail).toContain("over the message cap");
  });
});
