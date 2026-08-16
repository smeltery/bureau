// Where the Apps tab's name link points: the office's own answer when it has
// one, and otherwise the port link — whose interesting case is a tailnet
// office, where the obvious href is unreachable.
//
// Pure: no DOM, no server.

import { describe, expect, test } from "bun:test";
import { appHref, appLinkLabel } from "./appLinks.ts";

describe("appHref", () => {
  test("uses the app's own URL verbatim when it has one", () => {
    // The office computes the URL from its public origin and the app's issued
    // label; the UI must not rebuild any part of it. The hostname passed in is
    // deliberately unrelated, so a href that borrows from it fails here.
    expect(appHref({ url: "https://standup-board.office.example", port: 21000 }, "auntie")).toBe("https://standup-board.office.example");
  });

  test("keeps the port link for an empty URL rather than linking to nowhere", () => {
    // The wire omits `url` instead of sending "", so this is the fail-safe: an
    // empty href resolves to the office page the row is already on.
    expect(appHref({ url: "", port: 21000 }, "auntie")).toBe("http://auntie:21000/");
  });

  test("leaves a tailnet office's own URL alone", () => {
    // The office answers with the URL; the tailnet branch belongs to the port
    // link only and must not touch a hostname the office issued.
    expect(appHref({ url: "https://standup-board.office.example", port: 21001 }, "auntie.parrot-fish.ts.net")).toBe("https://standup-board.office.example");
  });

  test("links the app's port on this office's host", () => {
    expect(appHref({ port: 21000 }, "auntie")).toBe("http://auntie:21000/");
  });

  test("shortens a tailnet office to the node name", () => {
    // The bug this exists for: the browser upgrades http://<long tailnet
    // name>:<port> to https and the plain-http app port is unreachable. The
    // node's short name has no https history and MagicDNS resolves it.
    expect(appHref({ port: 21001 }, "auntie.parrot-fish.ts.net")).toBe("http://auntie:21001/");
  });

  test("shortens a tailnet name whatever its case", () => {
    expect(appHref({ port: 21001 }, "Auntie.Parrot-Fish.TS.NET")).toBe("http://auntie:21001/");
  });

  test("shortens a tailnet name written with the trailing root dot", () => {
    expect(appHref({ port: 21001 }, "auntie.parrot-fish.ts.net.")).toBe("http://auntie:21001/");
  });

  test("passes an ordinary domain through unchanged", () => {
    expect(appHref({ port: 21000 }, "office.example.com")).toBe("http://office.example.com:21000/");
  });

  test("matches the tailnet suffix on the label boundary", () => {
    // `ts.net` inside a name is not the MagicDNS namespace, and shortening
    // either of these would link the row at a host that resolves nowhere.
    expect(appHref({ port: 21000 }, "myts.net")).toBe("http://myts.net:21000/");
    expect(appHref({ port: 21000 }, "ts.net.example.com")).toBe("http://ts.net.example.com:21000/");
  });

  test("leaves the bare tailnet apex unchanged", () => {
    // No node label to shorten to.
    expect(appHref({ port: 21000 }, "ts.net")).toBe("http://ts.net:21000/");
  });

  test("leaves a hostname that is nothing but the suffix unchanged", () => {
    // Guards the empty-first-label fallback: without it the href would be
    // `http://:21000/`.
    expect(appHref({ port: 21000 }, ".ts.net")).toBe("http://.ts.net:21000/");
  });
});

describe("appLinkLabel", () => {
  test("uses a plain action for apps with issued URLs", () => {
    expect(appLinkLabel({ url: "https://standup-board.office.example" })).toBe("Open app");
  });

  test("makes port fallback scope explicit", () => {
    expect(appLinkLabel({})).toBe("Open on this network");
    expect(appLinkLabel({ url: "" })).toBe("Open on this network");
  });
});
