// The one place the relay is allowed to rewrite a header, and every case where
// it must not.
//
// Bun's fetch decodes some content codings transparently and leaves others
// alone, so a response can arrive with a `Content-Encoding` that is now a lie
// about its own bytes — or with one that is still perfectly true. Getting this
// backwards corrupts bodies in one direction or the other, which is why the rule
// mirrors the DECODER rather than the HTTP grammar, and why one test here pins
// the decoder itself rather than our code.

import { afterEach, describe, expect, it } from "bun:test";
import { brotliCompressSync, deflateSync, gzipSync, zstdCompressSync } from "zlib";
import { carriesDecodedCoding, _testResetRelay } from "../host/proxy.ts";
import { GZIP_TEXT, appRecord, get, relay, startUpstream, type Upstream } from "./host-proxy-test-kit.ts";

let up: Upstream | null = null;
afterEach(() => {
  up?.stop();
  up = null;
  _testResetRelay();
});

describe("relay: content encoding", () => {
  it("drops the encoding headers Bun's fetch has already made untrue", async () => {
    up = startUpstream();
    const res = await relay(get("/gzip"), { app: appRecord(up.port) });
    // Bun decompressed on the way in: forwarding `gzip` plus the COMPRESSED
    // length would hand the browser a lie and a wrong framing.
    expect(res.headers.get("content-encoding")).toBeNull();
    expect(res.headers.get("content-length")).toBeNull();
    expect(await res.text()).toBe(GZIP_TEXT);
  });

  it("does the same for brotli", async () => {
    up = startUpstream();
    const res = await relay(get("/brotli"), { app: appRecord(up.port) });
    expect(res.headers.get("content-encoding")).toBeNull();
    expect(res.headers.get("content-length")).toBeNull();
    expect(await res.text()).toBe(GZIP_TEXT);
  });

  it("leaves an encoding it did not decode completely alone", async () => {
    up = startUpstream();
    const res = await relay(get("/opaque-coding"), { app: appRecord(up.port) });
    expect(res.headers.get("content-encoding")).toBe("foo");
    expect(res.headers.get("content-length")).toBe("8");
    expect(await res.text()).toBe("rawbytes");
  });

  it("decodes alternate gzip spellings the runtime already expanded", async () => {
    up = startUpstream();
    const res = await relay(get("/shouty-gzip"), { app: appRecord(up.port) });
    expect(res.headers.get("content-encoding")).toBeNull();
    expect(await res.text()).toBe(GZIP_TEXT);
  });

  // The assumption the rewrite rests on, pinned against the runtime itself
  // rather than against our own code. If a Bun upgrade widens or narrows what
  // `fetch` decodes, this fails first and names the set to change — the
  // alternative is shipping bodies whose Content-Encoding is a lie.
  it("pins exactly which codings this runtime decodes", async () => {
    const text = "payload ".repeat(20);
    const bodies: Record<string, Buffer> = {
      gzip: gzipSync(Buffer.from(text)),
      br: brotliCompressSync(Buffer.from(text)),
      deflate: deflateSync(Buffer.from(text)),
      zstd: zstdCompressSync(Buffer.from(text)),
    };
    const cases: { header: string; body: keyof typeof bodies }[] = [
      { header: "gzip", body: "gzip" },
      { header: "deflate", body: "deflate" },
      { header: "br", body: "br" },
      { header: "zstd", body: "zstd" },
      { header: " gzip ", body: "gzip" },
      { header: "GZIP", body: "gzip" },
      { header: "Gzip", body: "gzip" },
      { header: "x-gzip", body: "gzip" },
      { header: "identity, gzip", body: "gzip" },
      { header: "foo", body: "gzip" },
    ];
    const server = Bun.serve({
      port: 0,
      hostname: "127.0.0.1",
      fetch(req) {
        const i = Number(new URL(req.url).pathname.slice(1));
        const body = new Uint8Array(bodies[cases[i].body]);
        return new Response(body, { headers: { "Content-Encoding": cases[i].header, "Content-Length": String(body.length) } });
      },
    });
    try {
      const observed: Record<string, boolean> = {};
      for (let i = 0; i < cases.length; i++) {
        const res = await fetch(`http://127.0.0.1:${server.port}/${i}`);
        const bytes = new Uint8Array(await res.arrayBuffer());
        observed[cases[i].header] = bytes.length === text.length;
      }
      expect(observed).toEqual({
        gzip: true,
        deflate: true,
        br: true,
        zstd: true,
        " gzip ": true,
        GZIP: true,
        Gzip: true,
        "x-gzip": true,
        "identity, gzip": true,
        foo: false,
      });
      // ...and the relay's rule says the same thing about each of them.
      for (const [header, decoded] of Object.entries(observed)) {
        expect({ header, rewrite: carriesDecodedCoding(header) }).toEqual({ header, rewrite: decoded });
      }
    } finally {
      void server.stop(true);
    }
  });

  it("keeps the metadata of a HEAD, which describes a body it never carried", async () => {
    up = startUpstream();
    const res = await relay(get("/head-gzip", { method: "HEAD" }), { app: appRecord(up.port) });
    expect({
      encoding: res.headers.get("content-encoding"),
      length: res.headers.get("content-length"),
      type: res.headers.get("content-type"),
    }).toEqual({ encoding: "gzip", length: "12345", type: "text/html" });
    expect(await res.text()).toBe("");
  });

  it("keeps the metadata of a 304, which updates a cached representation", async () => {
    up = startUpstream();
    const res = await relay(get("/304"), { app: appRecord(up.port) });
    // Content-Length is NOT asserted here: a 304 carries no body, and the
    // runtime rewrites the length to 0 on a bodyless status whatever we set.
    // The encoding is the one that matters — it describes the cached
    // representation the browser already holds, and the relay must not have
    // treated it as a claim about bytes it decoded.
    expect({ status: res.status, etag: res.headers.get("etag"), encoding: res.headers.get("content-encoding") }).toEqual({ status: 304, etag: '"v1"', encoding: "gzip" });
  });

  it("relays a 204 with no body", async () => {
    up = startUpstream();
    const res = await relay(get("/204"), { app: appRecord(up.port) });
    expect(res.status).toBe(204);
    expect(await res.text()).toBe("");
  });
});
