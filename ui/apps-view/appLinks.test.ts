// Where the Apps tab's name link points. Bureau has no app hostnames yet, so
// this is the port link and only the port link — the interesting case is a
// tailnet office, where the obvious href is unreachable.
//
// Pure: no DOM, no server.

import { describe, expect, test } from "bun:test";
import { appHref } from "./appLinks.ts";

describe("appHref", () => {
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
