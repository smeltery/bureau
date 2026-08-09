// Every byte an app hostname can send back before a real app answers.
//
// These read as trivial tests of trivial functions, and that is the point: the
// indistinguishability promise on this surface IS the response bytes. An unknown
// label, a retired one, an app this caller may not reach and a registry that
// cannot be read all go through neutralNotFound(), so a single stray header or a
// reworded body would turn the app-host arm into an oracle for which labels
// exist. Comparing whole responses is what keeps that from happening quietly.

import { describe, expect, it } from "bun:test";
import {
  APP_BUSY_BODY,
  APP_STOPPED_BODY,
  APP_UNREACHABLE_BODY,
  APP_WS_BAD_ORIGIN_BODY,
  APP_WS_PROTOCOL_MISMATCH_BODY,
  APP_WS_UPGRADE_FAILED_BODY,
  AUTH_REQUIRED_BODY,
  BAD_REQUEST_BODY,
  MINT_LIMITED_BODY,
  NOT_FOUND_BODY,
  SIGN_IN_FAILED_BODY,
  handshake,
  handshakeRedirect,
  neutral,
  neutralNotFound,
} from "./host-responses.ts";

const ALL_BODIES = [
  NOT_FOUND_BODY,
  AUTH_REQUIRED_BODY,
  SIGN_IN_FAILED_BODY,
  MINT_LIMITED_BODY,
  BAD_REQUEST_BODY,
  APP_STOPPED_BODY,
  APP_UNREACHABLE_BODY,
  APP_BUSY_BODY,
  APP_WS_BAD_ORIGIN_BODY,
  APP_WS_PROTOCOL_MISMATCH_BODY,
  APP_WS_UPGRADE_FAILED_BODY,
];

function headerMap(res: Response): Record<string, string> {
  return Object.fromEntries([...res.headers]);
}

describe("host responses: the bodies leak nothing", () => {
  it("is a closed set of fixed literals", () => {
    // No template holes, so no body can grow a host, a label, a path or a code
    // later on. A `${` here would be the whole property gone.
    for (const body of ALL_BODIES) {
      expect(body.endsWith("\n")).toBe(true);
      expect(body).not.toContain("${");
      expect(body.trim().length).toBeGreaterThan(0);
    }
  });

  it("says nothing about apps, hosts or credentials", () => {
    for (const body of ALL_BODIES) {
      for (const forbidden of ["hello", "office.example", "__host-", "cookie=", "u-alice", "code="]) {
        expect(body.toLowerCase()).not.toContain(forbidden);
      }
    }
  });

  it("tells an anonymous caller only two things: not found, and not authenticated", () => {
    // The two pre-auth bodies are deliberately vague; the specific ones below
    // them are only reachable by a caller who already holds an app session.
    expect(NOT_FOUND_BODY).toBe("not found\n");
    expect(AUTH_REQUIRED_BODY).toBe("authentication required\n");
    // And there is no "forbidden" body at all: a caller who may not reach an app
    // is told what a caller naming a nonexistent one is told.
    for (const body of ALL_BODIES) {
      expect(body.toLowerCase()).not.toContain("forbidden");
      expect(body.toLowerCase()).not.toContain("permission");
    }
  });
});

describe("neutral / neutralNotFound", () => {
  it("is a plain, uncacheable refusal and nothing more", async () => {
    const res = neutralNotFound();
    expect(res.status).toBe(404);
    expect(await res.text()).toBe(NOT_FOUND_BODY);
    expect(headerMap(res)).toEqual({ "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" });
    expect(res.headers.getSetCookie()).toEqual([]);
  });

  it("is THE 404: every neutral refusal is the same response", async () => {
    const a = neutralNotFound();
    const b = neutral(404, NOT_FOUND_BODY);
    expect(a.status).toBe(b.status);
    expect(headerMap(a)).toEqual(headerMap(b));
    expect(await a.text()).toBe(await b.text());
  });

  it("carries no Referrer-Policy, because its own URL carries no credential", () => {
    // The distinction from `handshake` below is deliberate rather than accidental.
    expect(neutralNotFound().headers.get("referrer-policy")).toBeNull();
  });
});

describe("handshake", () => {
  it("adds no-referrer to a plain refusal, because its URL may hold a code", async () => {
    const res = handshake(400, SIGN_IN_FAILED_BODY);
    expect(res.status).toBe(400);
    expect(await res.text()).toBe(SIGN_IN_FAILED_BODY);
    expect(headerMap(res)).toEqual({ "content-type": "text/plain; charset=utf-8", "cache-control": "no-store", "referrer-policy": "no-referrer" });
  });

  it("merges extra headers without losing the anti-leak pair", () => {
    const res = handshake(401, AUTH_REQUIRED_BODY, { "Set-Cookie": "__Host-bureau_app=; Path=/; Max-Age=0; Secure" });
    expect(res.headers.getSetCookie().length).toBe(1);
    expect(res.headers.get("referrer-policy")).toBe("no-referrer");
    expect(res.headers.get("cache-control")).toBe("no-store");
  });
});

describe("handshakeRedirect", () => {
  it("is a 302 with the anti-leak pair and no body", async () => {
    const res = handshakeRedirect("/dashboard?tab=1");
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/dashboard?tab=1");
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(res.headers.get("referrer-policy")).toBe("no-referrer");
    expect(await res.text()).toBe("");
    expect(res.headers.getSetCookie()).toEqual([]);
  });

  it("appends every Set-Cookie line rather than dropping them", () => {
    // An array in a plain headers object is silently dropped by Bun, and a
    // silently dropped cookie here is an endless redirect.
    const lines = ["__Host-bureau_app=abc; Path=/; Secure", "bureau_session=; Path=/; Max-Age=0; Secure"];
    expect(handshakeRedirect("/", lines).headers.getSetCookie()).toEqual(lines);
  });
});
