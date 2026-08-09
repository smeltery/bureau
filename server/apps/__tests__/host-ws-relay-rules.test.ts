// The relay's pure rules: the subprotocol offer, the Origin, and how an upstream
// close is spelled to a browser.

import { describe, expect, it } from "bun:test";
import { APP_WS_MAX_PROTOCOL_HEADER_BYTES, endingFor, fault, goingAway, originAllowed, parseOfferedProtocols, sizeOf } from "../host/ws-relay-rules.ts";

describe("host-ws-relay-rules: the subprotocol offer", () => {
  it("parses an offer strictly", () => {
    expect(parseOfferedProtocols(null)).toEqual([]);
    expect(parseOfferedProtocols("chat")).toEqual(["chat"]);
    expect(parseOfferedProtocols("chat, superchat")).toEqual(["chat", "superchat"]);
    // The size bound, at the boundary: one byte under is a list, one byte over
    // is refused. A token can be syntactically perfect and still be absurd, and
    // an absurd one would otherwise be forwarded into the upstream client's
    // upgrade request and refused there, after a permit and a dial.
    const atBound = "a".repeat(APP_WS_MAX_PROTOCOL_HEADER_BYTES);
    expect(parseOfferedProtocols(atBound)).toEqual([atBound]);
    expect(parseOfferedProtocols("a".repeat(APP_WS_MAX_PROTOCOL_HEADER_BYTES + 1))).toBe(null);
    // Also over the bound as a LIST of legal tokens, not one long one.
    expect(parseOfferedProtocols(Array.from({ length: 200 }, (_, i) => `chat-${i}-${"x".repeat(20)}`).join(", "))).toBe(null);
    // Every malformed shape is `null`, i.e. refuse — never "no offer", because
    // Bun would then answer with a value nothing validated.
    for (const bad of ["", "   ", "chat, chat", "not a token", "chat,,x", "chat, ", "ch@t", "chat\r\nX-Evil: 1"]) {
      expect({ bad, parsed: parseOfferedProtocols(bad) }).toEqual({ bad, parsed: null });
    }
  });
});

describe("host-ws-relay-rules: the Origin", () => {
  it("allows an absent Origin and exactly one present value", () => {
    expect(originAllowed(null, "hello.office.example")).toBe(true);
    expect(originAllowed("https://hello.office.example", "hello.office.example")).toBe(true);
    for (const bad of ["http://hello.office.example", "https://hello.office.example:443", "https://hello.office.example/", "https://office.example", "https://evil.test", "null", ""]) {
      expect({ bad, ok: originAllowed(bad, "hello.office.example") }).toEqual({ bad, ok: false });
    }
  });
});

describe("host-ws-relay-rules: how a close is spelled to the browser", () => {
  it("keeps a clean close clean and a dropped one dropped", () => {
    // CLEAN versus DROPPED is the distinction client code acts on: a reconnect
    // loop triggers on 1006.
    expect(endingFor({ code: 4001, reason: "app done", abnormal: false, detail: null })).toEqual({ kind: "close", code: 4001, reason: "app done" });
    expect(endingFor({ code: null, reason: "", abnormal: true, detail: "socket closed" })).toEqual({ kind: "terminate" });
    // A code that cannot go on the wire is not substituted with another number.
    expect(endingFor({ code: 1006, reason: "", abnormal: false, detail: null })).toEqual({ kind: "terminate" });
  });

  it("invents 1000 for a clean close with no status, which is the smaller lie", () => {
    // Bun's server API cannot emit the status-less form at all, so the choice is
    // between 1000 (keeps the close in the CLEAN family, invents a status) and
    // 1006 (keeps "no status", moves a deliberate goodbye into the FAILED
    // family). RFC 6455 7.1.5 already treats a status-less close as normal.
    expect(endingFor({ code: null, reason: "", abnormal: false, detail: null })).toEqual({ kind: "close", code: 1000, reason: "" });
  });

  it("cuts a long reason on a code-point boundary", () => {
    const ending = endingFor({ code: 1000, reason: "€".repeat(60), abnormal: false, detail: null });
    expect(ending.kind).toBe("close");
    if (ending.kind === "close") {
      expect(Buffer.byteLength(ending.reason, "utf8")).toBeLessThanOrEqual(123);
      expect(ending.reason).toBe("€".repeat(41));
    }
  });
});

describe("host-ws-relay-rules: endings and sizes", () => {
  it("sends a diagnosed fault to BOTH ends with the same code and reason", () => {
    // The defect this shape exists for: telling the browser the ruled code and
    // the app a flat 1001 "going away" meant an app whose client sent an
    // oversized message learned that the office was shutting down.
    expect(fault(1009, "message too large")).toEqual({ browser: { kind: "close", code: 1009, reason: "message too large" }, upstream: { code: 1009, reason: "message too large" } });
    // Nothing to say to a browser leg that does not exist.
    expect(goingAway("office closed the socket")).toEqual({ browser: null, upstream: { code: 1001, reason: "office closed the socket" } });
  });

  it("measures a message in wire bytes, not characters", () => {
    expect(sizeOf({ kind: "text", text: "€" })).toBe(3);
    expect(sizeOf({ kind: "binary", data: Buffer.alloc(7) })).toBe(7);
  });
});
