// The app-host handshake's pure decisions: who may reach an app, which requests
// may start the sign-in round trip, and where a browser may be sent back to.
//
// What this freezes:
//   - `r` IS A PATH. The open-redirect surface of the whole feature is one
//     function, so its refusals are pinned individually rather than sampled. Raw
//     control characters are only testable here: by the time a request has been
//     through Bun's URL parser they are encoded or gone.
//   - Only a request that could FINISH the handshake is sent into it, and the
//     one permissive arm (no Fetch Metadata at all) is deliberate rather than an
//     oversight — so a partial signal must not accidentally fall into it.
//   - The PERMIT TABLE: the app's owner, office owners, and users sharing the
//     live creator's room. Same rule the /api/apps routes use for visibility,
//     which is the invariant that keeps a hostname from being a back door around
//     it.
//
// No server, no clock, no I/O.

import { describe, expect, it } from "bun:test";
import { mayInitiateHandshake, mayReachApp, validateReturnPath } from "../host/auth-permit.ts";

const HOST = "hello.office.example";

function req(headers: Record<string, string> = {}, method = "GET", url = `https://${HOST}/`): Request {
  return new Request(url, { method, headers });
}

describe("validateReturnPath", () => {
  it("keeps a real path verbatim, query and percent-encoding included", () => {
    expect(validateReturnPath("/")).toBe("/");
    expect(validateReturnPath("/a/b")).toBe("/a/b");
    expect(validateReturnPath("/a/b?x=1&y=2")).toBe("/a/b?x=1&y=2");
    expect(validateReturnPath("/caf%C3%A9/men%C3%BC")).toBe("/caf%C3%A9/men%C3%BC");
    // A single encoded slash is a path segment, not a second leading slash.
    expect(validateReturnPath("/%2Fnot-authority")).toBe("/%2Fnot-authority");
  });

  it("defaults to / when absent, and refuses an empty value", () => {
    expect(validateReturnPath(null)).toBe("/");
    expect(validateReturnPath("")).toBeNull();
  });

  it("refuses everything that could leave the app host", () => {
    // Protocol-relative: a browser reads the authority after `//`.
    expect(validateReturnPath("//evil.example")).toBeNull();
    expect(validateReturnPath("//evil.example/path")).toBeNull();
    // Absolute URLs in any shape - none of them start with a single slash.
    expect(validateReturnPath("https://evil.example")).toBeNull();
    expect(validateReturnPath("http://evil.example")).toBeNull();
    expect(validateReturnPath("evil.example")).toBeNull();
    // Backslash: historically read as an authority separator.
    expect(validateReturnPath("/\\evil.example")).toBeNull();
    expect(validateReturnPath("\\\\evil.example")).toBeNull();
    expect(validateReturnPath("/path/\\evil")).toBeNull();
    // A userinfo trick still needs a `//` or a scheme to work.
    expect(validateReturnPath("/@evil.example")).toBe("/@evil.example");
  });

  it("refuses anything that could split or dirty a Location header", () => {
    expect(validateReturnPath("/a\r\nX-Injected: 1")).toBeNull();
    expect(validateReturnPath("/a\nX")).toBeNull();
    expect(validateReturnPath("/a\rX")).toBeNull();
    expect(validateReturnPath("/a\tb")).toBeNull();
    expect(validateReturnPath("/a b")).toBeNull();
    expect(validateReturnPath("/a\u0000b")).toBeNull();
    expect(validateReturnPath("/a\u007fb")).toBeNull();
    // Non-ASCII: browsers percent-encode it, so a raw one is hand-written.
    expect(validateReturnPath("/café")).toBeNull();
    // A fragment never reaches a server, so one arriving here is hand-written.
    expect(validateReturnPath("/a#frag")).toBeNull();
  });

  it("refuses an over-long path", () => {
    expect(validateReturnPath(`/${"a".repeat(2047)}`)).toBeTruthy();
    expect(validateReturnPath(`/${"a".repeat(2048)}`)).toBeNull();
  });
});

describe("mayInitiateHandshake", () => {
  const NAV = { "sec-fetch-mode": "navigate", "sec-fetch-dest": "document" };

  it("accepts a GET carrying the exact navigation pair", () => {
    expect(mayInitiateHandshake(req(NAV))).toBe(true);
  });

  it("refuses every method but GET, navigation pair or not", () => {
    // HEAD is out DELIBERATELY: it could start the flow, but the callback is
    // GET-only, so a client that preserved the method across the redirect would
    // be stranded at the second hop instead of the first.
    for (const method of ["HEAD", "POST", "PUT", "PATCH", "DELETE"]) {
      expect(mayInitiateHandshake(req(NAV, method))).toBe(false);
      expect(mayInitiateHandshake(req({}, method))).toBe(false);
    }
  });

  it("refuses every other fetch mode and destination", () => {
    for (const mode of ["cors", "same-origin", "no-cors", "websocket"]) {
      expect(mayInitiateHandshake(req({ "sec-fetch-mode": mode, "sec-fetch-dest": "document" }))).toBe(false);
    }
    for (const dest of ["", "empty", "script", "image", "iframe", "style"]) {
      expect(mayInitiateHandshake(req({ "sec-fetch-mode": "navigate", "sec-fetch-dest": dest }))).toBe(false);
    }
  });

  it("refuses a partial pair - one Sec-Fetch header present is ambiguous", () => {
    expect(mayInitiateHandshake(req({ "sec-fetch-mode": "navigate" }))).toBe(false);
    expect(mayInitiateHandshake(req({ "sec-fetch-dest": "document" }))).toBe(false);
    expect(mayInitiateHandshake(req({ ...NAV, "sec-fetch-site": "cross-site" }))).toBe(true);
    // Sec-Fetch metadata present but not the navigation pair, even partially:
    // this is the case the compatibility arm must NOT swallow.
    expect(mayInitiateHandshake(req({ "sec-fetch-site": "same-origin" }))).toBe(false);
    expect(mayInitiateHandshake(req({ ...NAV, "sec-fetch-mode": "cors" }))).toBe(false);
  });

  it("compares values exactly, so a re-cased value is refused", () => {
    expect(mayInitiateHandshake(req({ "sec-fetch-mode": "Navigate", "sec-fetch-dest": "document" }))).toBe(false);
    expect(mayInitiateHandshake(req({ "sec-fetch-mode": "navigate", "sec-fetch-dest": "DOCUMENT" }))).toBe(false);
  });

  it("accepts a GET with NO Sec-Fetch metadata at all", () => {
    // The compatibility arm, and it is a decision rather than an oversight: a
    // client that never sends Fetch Metadata would otherwise be unable to sign in
    // to an app at all. It is NOT a claim that such a client is safe - it can be
    // made to issue a cross-site request and can carry cookies; the absence of the
    // headers is exactly why its context cannot be told apart from a navigation's.
    expect(mayInitiateHandshake(req())).toBe(true);
    expect(mayInitiateHandshake(req({ accept: "text/html" }))).toBe(true);
    expect(mayInitiateHandshake(req({ cookie: "x=1" }))).toBe(true);
    // But ANY Sec-Fetch header means the client speaks Fetch Metadata, so the
    // exact pair becomes mandatory - a partial signal is not the arm above.
    expect(mayInitiateHandshake(req({ "sec-fetch-user": "?1" }))).toBe(false);
    expect(mayInitiateHandshake(req({ "sec-fetch-site": "none" }))).toBe(false);
  });
});

describe("mayReachApp: the permit table", () => {
  const alice = { userId: "u-alice", role: "member" } as const;
  const bob = { userId: "u-bob", role: "member" } as const;
  const boss = { userId: "u-boss", role: "owner" } as const;
  const aliceApp = { userId: "u-alice" };
  const unowned = { userId: null };

  it("permits the app's own owner", () => {
    expect(mayReachApp(aliceApp, alice)).toBe(true);
  });

  it("refuses another member, whose app it is not", () => {
    expect(mayReachApp(aliceApp, bob)).toBe(false);
  });

  it("permits another member when the live creator room is visible", () => {
    expect(mayReachApp(aliceApp, { ...bob, hasCreatorRoomAccess: true })).toBe(true);
    expect(mayReachApp(unowned, { ...bob, hasCreatorRoomAccess: true })).toBe(true);
  });

  it("permits an office owner, whoever's app it is", () => {
    expect(mayReachApp(aliceApp, boss)).toBe(true);
    expect(mayReachApp(unowned, boss)).toBe(true);
  });

  it("refuses a member on an unowned app", () => {
    // An unowned app was registered from a loopback shell, so it belongs to the
    // box. A null owner must never match a null-ish caller by accident either.
    expect(mayReachApp(unowned, alice)).toBe(false);
    expect(mayReachApp(unowned, { userId: "", role: "member" })).toBe(false);
  });

  it("refuses when there is no live office session at all", () => {
    // The only "not signed in" answer: no identity, no permit, for every app
    // including an unowned one.
    expect(mayReachApp(aliceApp, null)).toBe(false);
    expect(mayReachApp(unowned, null)).toBe(false);
  });
});
