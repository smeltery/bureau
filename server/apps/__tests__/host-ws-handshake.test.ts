// The upgrade request the relay writes, and the response it will accept back.
//
// Both halves are pure, and both are about a value a BROWSER chose ending up in
// bytes the app parses: a header value that could forge a line, a subprotocol
// nobody offered, an accept value that proves nothing.

import { describe, expect, it } from "bun:test";
import { buildHandshakeRequest, checkHandshakeResponse, handshakeAccept, isSafeHeaderName, isSafeHeaderValue, isSafeRequestTarget } from "../host/ws-handshake.ts";

describe("host-ws-handshake: the upgrade request", () => {
  it("writes the handshake a server expects", () => {
    const bytes = buildHandshakeRequest({
      target: "/socket?x=1",
      host: "hello.office.example",
      key: "dGhlIHNhbXBsZSBub25jZQ==",
      protocols: ["graphql-ws", "json"],
      headers: { "User-Agent": "browser/1", Cookie: "app_pref=blue" },
    });
    expect(bytes).not.toBeNull();
    expect(bytes!.toString()).toBe(
      [
        "GET /socket?x=1 HTTP/1.1",
        "Host: hello.office.example",
        "Upgrade: websocket",
        "Connection: Upgrade",
        "Sec-WebSocket-Version: 13",
        "Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==",
        "Sec-WebSocket-Protocol: graphql-ws, json",
        "User-Agent: browser/1",
        "Cookie: app_pref=blue",
        "",
        "",
      ].join("\r\n"),
    );
    // No extension is ever offered, which is what lets the decoder treat a
    // reserved bit as a protocol error.
    expect(bytes!.toString()).not.toContain("Sec-WebSocket-Extensions");
  });

  it("never writes a header the client owns twice", () => {
    // A caller that forwards the browser's own Host or Sec-WebSocket-Key would
    // otherwise produce two of each, and which one the app reads is anybody's
    // guess.
    const bytes = buildHandshakeRequest({
      target: "/",
      host: "hello.office.example",
      key: "K",
      protocols: [],
      headers: {
        Host: "evil.example",
        "Sec-WebSocket-Key": "other",
        "Sec-WebSocket-Version": "8",
        "Sec-WebSocket-Extensions": "permessage-deflate",
        Connection: "keep-alive",
        Upgrade: "h2c",
        "Content-Length": "10",
      },
    })!.toString();
    expect(bytes.match(/^Host:/gm)).toEqual(["Host:"]);
    expect(bytes).toContain("Host: hello.office.example");
    expect(bytes).not.toContain("evil.example");
    expect(bytes.match(/Sec-WebSocket-Key/g)).toEqual(["Sec-WebSocket-Key"]);
    expect(bytes).not.toContain("permessage-deflate");
    expect(bytes).not.toContain("Content-Length");
  });

  it("refuses to build a request from values that could forge header lines", () => {
    const base = { target: "/", host: "hello.office.example", key: "K", protocols: [] as string[], headers: {} as Record<string, string> };
    // A CRLF in a value is the whole reason this validation exists: it would
    // write extra headers — or a second request — into what the app receives.
    expect(buildHandshakeRequest({ ...base, headers: { "X-A": "a\r\nX-Injected: 1" } })).toBeNull();
    expect(buildHandshakeRequest({ ...base, headers: { "X-A": "a\nb" } })).toBeNull();
    expect(buildHandshakeRequest({ ...base, headers: { "X-A": "a\0b" } })).toBeNull();
    expect(buildHandshakeRequest({ ...base, headers: { "X A": "fine" } })).toBeNull();
    expect(buildHandshakeRequest({ ...base, headers: { "X:A": "fine" } })).toBeNull();
    expect(buildHandshakeRequest({ ...base, host: "host\r\nX: 1" })).toBeNull();
    expect(buildHandshakeRequest({ ...base, host: "" })).toBeNull();
    expect(buildHandshakeRequest({ ...base, target: "not-a-path" })).toBeNull();
    expect(buildHandshakeRequest({ ...base, target: "/a b" })).toBeNull();
    expect(buildHandshakeRequest({ ...base, target: "/a\r\nX: 1" })).toBeNull();
    expect(buildHandshakeRequest({ ...base, protocols: ["a b"] })).toBeNull();
    expect(buildHandshakeRequest({ ...base, protocols: ["a\r\nX: 1"] })).toBeNull();
  });

  it("agrees with itself about what is safe", () => {
    expect(isSafeHeaderName("X-Forwarded-For")).toBe(true);
    expect(isSafeHeaderName("bad name")).toBe(false);
    expect(isSafeHeaderValue("plain")).toBe(true);
    expect(isSafeHeaderValue("with\ttab")).toBe(false);
    expect(isSafeHeaderValue("del\x7f")).toBe(false);
    expect(isSafeRequestTarget("/ok?q=1")).toBe(true);
    expect(isSafeRequestTarget("relative")).toBe(false);
  });

  it("computes the accept value the RFC specifies", () => {
    // The example from RFC 6455 section 1.3.
    expect(handshakeAccept("dGhlIHNhbXBsZSBub25jZQ==")).toBe("s3pPLMBiTxaQ9kYGzzhZRbK+xOo=");
  });
});

describe("host-ws-handshake: validating the upgrade response", () => {
  const accept = handshakeAccept("K");
  const good = ["HTTP/1.1 101 Switching Protocols", "Upgrade: websocket", "Connection: Upgrade", `Sec-WebSocket-Accept: ${accept}`].join("\r\n");

  it("accepts a correct handshake", () => {
    expect(checkHandshakeResponse(good, accept, [])).toEqual({ ok: true, protocol: null });
  });

  it("accepts tokenized Connection and Upgrade values case-insensitively", () => {
    const head = ["HTTP/1.1 101 Switching Protocols", "Upgrade: WebSocket", "Connection: keep-alive, Upgrade", `Sec-WebSocket-Accept: ${accept}`].join("\r\n");
    expect(checkHandshakeResponse(head, accept, [])).toEqual({ ok: true, protocol: null });
  });

  it("returns the negotiated subprotocol when it was offered", () => {
    const head = `${good}\r\nSec-WebSocket-Protocol: graphql-ws`;
    expect(checkHandshakeResponse(head, accept, ["graphql-ws", "json"])).toEqual({ ok: true, protocol: "graphql-ws" });
  });

  it("calls a subprotocol nobody offered its own kind of failure", () => {
    // The relay owes that one a different, debuggable answer: the browser asked
    // for an application protocol and the app did not agree to it.
    const res = checkHandshakeResponse(`${good}\r\nSec-WebSocket-Protocol: mystery`, accept, ["graphql-ws"]);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.kind).toBe("protocol");
  });

  it("refuses an HTTP/1.0 upgrade response", () => {
    // RFC 6455's handshake is defined on HTTP/1.1.
    const head = ["HTTP/1.0 101 Switching Protocols", "Upgrade: websocket", "Connection: Upgrade", `Sec-WebSocket-Accept: ${accept}`].join("\r\n");
    expect(checkHandshakeResponse(head, accept, []).ok).toBe(false);
  });

  const rejections: { name: string; head: string; offered?: string[] }[] = [
    { name: "a 200 page instead of an upgrade", head: "HTTP/1.1 200 OK\r\nContent-Type: text/html" },
    { name: "a 404", head: "HTTP/1.1 404 Not Found" },
    { name: "a redirect", head: "HTTP/1.1 302 Found\r\nLocation: /elsewhere" },
    {
      name: "a missing upgrade token in Connection",
      head: ["HTTP/1.1 101 Switching Protocols", "Upgrade: websocket", "Connection: keep-alive", `Sec-WebSocket-Accept: ${accept}`].join("\r\n"),
    },
    {
      name: "an Upgrade that is not websocket",
      head: ["HTTP/1.1 101 Switching Protocols", "Upgrade: h2c", "Connection: Upgrade", `Sec-WebSocket-Accept: ${accept}`].join("\r\n"),
    },
    {
      name: "a wrong accept value",
      head: ["HTTP/1.1 101 Switching Protocols", "Upgrade: websocket", "Connection: Upgrade", "Sec-WebSocket-Accept: bm90LXRoZS1yaWdodC1vbmU="].join("\r\n"),
    },
    { name: "a missing accept value", head: good.split("\r\nSec-WebSocket-Accept")[0] },
    { name: "an extension we never offered", head: `${good}\r\nSec-WebSocket-Extensions: permessage-deflate` },
    { name: "two subprotocol headers", head: `${good}\r\nSec-WebSocket-Protocol: a\r\nSec-WebSocket-Protocol: b`, offered: ["a", "b"] },
    { name: "a subprotocol that was never offered", head: `${good}\r\nSec-WebSocket-Protocol: mystery`, offered: ["graphql-ws"] },
    { name: "a subprotocol when none was offered", head: `${good}\r\nSec-WebSocket-Protocol: mystery` },
    { name: "duplicated accept headers", head: `${good}\r\nSec-WebSocket-Accept: ${accept}` },
  ];
  for (const c of rejections) {
    it(`refuses ${c.name}`, () => {
      expect(checkHandshakeResponse(c.head, accept, c.offered ?? []).ok).toBe(false);
    });
  }
});
