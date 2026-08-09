import { describe, expect, test } from "bun:test";
import { matchAppHost, normalizeRequestHost } from "./host-match.ts";

describe("normalizeRequestHost", () => {
  test("folds case, strips the port and one trailing dot", () => {
    expect(normalizeRequestHost("Office.Example")).toBe("office.example");
    expect(normalizeRequestHost("office.example:4000")).toBe("office.example");
    expect(normalizeRequestHost("office.example.")).toBe("office.example");
    expect(normalizeRequestHost("HELLO.Office.Example:443")).toBe("hello.office.example");
  });

  test("an absent, empty or non-ASCII Host is not ours (never a refusal)", () => {
    expect(normalizeRequestHost(null)).toBeNull();
    expect(normalizeRequestHost(undefined)).toBeNull();
    expect(normalizeRequestHost("")).toBeNull();
    // No IDNA folding on purpose: a non-ASCII Host can never equal an ASCII
    // office host, and an A-label is already ASCII.
    expect(normalizeRequestHost("héllo.office.example")).toBeNull();
    expect(normalizeRequestHost("ｔｓ.example")).toBeNull();
    expect(normalizeRequestHost("office.example\r\nX: y")).toBeNull();
  });

  test("an IPv6 literal and a malformed port are refused", () => {
    expect(normalizeRequestHost("[::1]:4000")).toBeNull();
    expect(normalizeRequestHost("office.example:")).toBeNull();
    expect(normalizeRequestHost("office.example:80a")).toBeNull();
    expect(normalizeRequestHost("office.example:80:80")).toBeNull();
  });

  test("a double trailing dot leaves an empty label and is refused", () => {
    expect(normalizeRequestHost("office.example..")).toBeNull();
    expect(normalizeRequestHost("hello..office.example")).toBeNull();
  });
});

describe("matchAppHost", () => {
  const domain = "office.example";

  test("exactly one label below the office is a candidate app", () => {
    expect(matchAppHost("hello.office.example", domain)).toEqual({ kind: "label", label: "hello" });
  });

  test("the office's own host never matches — that is what keeps it reachable", () => {
    expect(matchAppHost(domain, domain)).toBeNull();
  });

  test("anything outside the domain is not ours", () => {
    expect(matchAppHost("other.example", domain)).toBeNull();
    // A suffix that is not a label boundary: `notoffice.example` must not read
    // as a child of `office.example`.
    expect(matchAppHost("nototherffice.example", domain)).toBeNull();
    expect(matchAppHost("office.example.evil.test", domain)).toBeNull();
  });

  test("deeper names divert but can never name an app", () => {
    expect(matchAppHost("a.b.office.example", domain)).toEqual({ kind: "under" });
  });

  test("a reserved app name still routes as a label: refusal and routing are separate invariants", () => {
    // `api` cannot be REGISTERED (the registry's reserved list), but an
    // unregistered label must not fall through to the office either — it 404s as
    // an unknown app.
    expect(matchAppHost("api.office.example", domain)).toEqual({ kind: "label", label: "api" });
  });
});
