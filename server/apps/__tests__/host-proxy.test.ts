// The HTTP relay, against a real upstream on a real loopback socket: the bytes
// it carries, and what it refuses to carry.
//
// Everything here drives `relayToApp` directly, with a scratch server standing
// in for the app (server/apps/__tests__/host-proxy-test-kit.ts). The strongest assertions
// in the file are the negative ones: what the app is NOT handed — the office's
// cookies, a client's X-Forwarded-*, the hop-by-hop headers that stop at a
// proxy.

import { afterEach, describe, expect, it } from "bun:test";
import { forwardedForValue, _testResetRelay } from "../host/proxy.ts";
import { APP_HOST, BINARY, appRecord, get, relay, startUpstream, type Upstream } from "./host-proxy-test-kit.ts";

let up: Upstream | null = null;
afterEach(() => {
  up?.stop();
  up = null;
  _testResetRelay();
});

describe("relay: the app's bytes", () => {
  it("passes a binary body through byte-exact", async () => {
    up = startUpstream();
    const res = await relay(get("/binary"), { app: appRecord(up.port) });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/octet-stream");
    const bytes = new Uint8Array(await res.arrayBuffer());
    expect(bytes.length).toBe(BINARY.length);
    expect(Buffer.from(bytes).equals(Buffer.from(BINARY))).toBe(true);
  });

  it("streams a fixed-length POST body and preserves its framing", async () => {
    // A STREAM body plus the client's own Content-Length, which is what the
    // server hands the relay for an ordinary upload. If the length were dropped
    // the bytes would still arrive, just re-framed as chunked — so the framing
    // is what this asserts, and a buffered body would not be able to tell the
    // difference.
    up = startUpstream();
    const payload = "x".repeat(5000);
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(payload));
        controller.close();
      },
    });
    const res = await relay(get("/echo", { method: "POST", body, headers: { "Content-Type": "text/plain", "Content-Length": String(payload.length) } }), { app: appRecord(up.port) });
    expect(await res.text()).toBe(payload);
    expect(up.seen[0].headers["content-length"]).toBe(String(payload.length));
    expect(up.seen[0].headers["transfer-encoding"]).toBeUndefined();
  });

  it("streams a chunked POST body when the client sent no length", async () => {
    up = startUpstream();
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("chunk-one;"));
        controller.enqueue(new TextEncoder().encode("chunk-two"));
        controller.close();
      },
    });
    const res = await relay(get("/echo", { method: "POST", body }), { app: appRecord(up.port) });
    expect(await res.text()).toBe("chunk-one;chunk-two");
    expect(up.seen[0].headers["transfer-encoding"]).toBe("chunked");
    expect(up.seen[0].headers["content-length"]).toBeUndefined();
  });

  it("sends no body on GET or HEAD", async () => {
    up = startUpstream();
    const app = appRecord(up.port);
    await relay(get("/plain"), { app });
    await relay(get("/plain", { method: "HEAD" }), { app });
    for (const seen of up.seen) {
      expect(seen.headers["content-length"] ?? "0").toBe("0");
      expect(seen.headers["transfer-encoding"]).toBeUndefined();
    }
  });

  it("does not follow a redirect", async () => {
    up = startUpstream();
    const res = await relay(get("/redirect"), { app: appRecord(up.port) });
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/somewhere-else");
    // One request: the relay did not chase it.
    expect(up.seen.map((s) => s.path)).toEqual(["/redirect"]);
  });

  it("keeps two Set-Cookie lines separate, comma and all", async () => {
    up = startUpstream();
    const res = await relay(get("/cookies"), { app: appRecord(up.port) });
    expect(res.headers.getSetCookie()).toEqual(["sid=abc; Expires=Wed, 09 Jun 2027 10:18:14 GMT; Path=/", "theme=dark; Path=/; SameSite=Lax"]);
  });

  it("streams incrementally rather than buffering", async () => {
    up = startUpstream();
    const res = await relay(get("/sse"), { app: appRecord(up.port) });
    const reader = res.body!.getReader();
    const started = Date.now();
    const first = await reader.read();
    const firstAt = Date.now() - started;
    expect(new TextDecoder().decode(first.value)).toContain("data: 0");
    // The whole stream is 50 ticks at 30ms; a buffering relay could not have
    // produced the first one this early.
    expect(firstAt).toBeLessThan(500);
    await reader.cancel();
  });
});

describe("relay: what the app is not handed", () => {
  it("strips every bureau credential cookie and keeps the app's own", async () => {
    up = startUpstream();
    await relay(
      get("/plain", {
        headers: {
          Cookie: [
            "__Host-bureau_app=APPTOKEN",
            "__Host-bureau_session=OFFICETOKEN",
            "bureau_session=LEGACYTOKEN",
            "bureau_session_id=theirs",
            "BUREAU_SESSION=theirs-too",
            "my__Host-bureau_app=nope",
            "theme=dark",
          ].join("; "),
        },
      }),
      { app: appRecord(up.port) },
    );
    expect(up.seen[0].headers["cookie"]).toBe("bureau_session_id=theirs; BUREAU_SESSION=theirs-too; my__Host-bureau_app=nope; theme=dark");
  });

  it("sends no Cookie header at all when only ours were present", async () => {
    up = startUpstream();
    await relay(get("/plain", { headers: { Cookie: "__Host-bureau_app=APPTOKEN" } }), { app: appRecord(up.port) });
    expect(up.seen[0].headers["cookie"]).toBeUndefined();
  });

  it("drops hop-by-hop headers and everything Connection names", async () => {
    up = startUpstream();
    await relay(
      get("/plain", {
        headers: {
          Connection: "X-Secret-Hop, keep-alive",
          "X-Secret-Hop": "must not arrive",
          "Keep-Alive": "timeout=5",
          TE: "trailers",
          Trailer: "X-Thing",
          Upgrade: "h2c",
          "Proxy-Authorization": "Basic abc",
          "X-Ordinary": "arrives",
        },
      }),
      { app: appRecord(up.port) },
    );
    const seen = up.seen[0].headers;
    for (const name of ["x-secret-hop", "keep-alive", "te", "trailer", "upgrade", "proxy-authorization"]) {
      expect({ name, value: seen[name] }).toEqual({ name, value: undefined as string | undefined });
    }
    expect(seen["x-ordinary"]).toBe("arrives");
  });

  it("owns the forwarding headers instead of relaying the client's", async () => {
    up = startUpstream();
    await relay(
      get("/plain", {
        headers: {
          Host: "impostor.example",
          "X-Forwarded-For": "9.9.9.9",
          "X-Forwarded-Proto": "http",
          "X-Forwarded-Host": "impostor.example",
          Forwarded: "for=9.9.9.9;host=impostor.example",
        },
      }),
      { app: appRecord(up.port), peer: () => "203.0.113.7" },
    );
    const seen = up.seen[0].headers;
    expect({
      host: seen["host"],
      xff: seen["x-forwarded-for"],
      proto: seen["x-forwarded-proto"],
      xfh: seen["x-forwarded-host"],
      forwarded: seen["forwarded"],
    }).toEqual({ host: APP_HOST, xff: "203.0.113.7", proto: "https", xfh: APP_HOST, forwarded: undefined as string | undefined });
  });

  it("writes an IPv4-mapped loopback peer the way a proxy writes it", async () => {
    // Bun reports a dual-stack loopback peer as `::ffff:127.0.0.1`. Same
    // address, spelling most XFF parsers have never met.
    up = startUpstream();
    await relay(get("/plain"), { app: appRecord(up.port), peer: () => "::ffff:127.0.0.1" });
    expect(up.seen[0].headers["x-forwarded-for"]).toBe("127.0.0.1");
    // A real IPv6 peer is written bare — the bracketed form belongs to the
    // `Forwarded` header's grammar, not this one.
    expect(forwardedForValue("2001:db8::1")).toBe("2001:db8::1");
    expect(forwardedForValue(null)).toBeNull();
  });

  it("omits X-Forwarded-For when there is no peer to name", async () => {
    up = startUpstream();
    const app = appRecord(up.port);
    await relay(get("/plain", { headers: { "X-Forwarded-For": "9.9.9.9" } }), { app, peer: () => null });
    await relay(get("/plain"), {
      app,
      peer: () => {
        throw new Error("socket gone");
      },
    });
    expect(up.seen.map((s) => s.headers["x-forwarded-for"])).toEqual([undefined, undefined]);
  });

  it("does not relay the app's own hop-by-hop headers back", async () => {
    up = startUpstream();
    const res = await relay(get("/hop"), { app: appRecord(up.port) });
    expect({
      priv: res.headers.get("x-private"),
      keepAlive: res.headers.get("keep-alive"),
      proxyAuth: res.headers.get("proxy-authenticate"),
      pub: res.headers.get("x-public"),
    }).toEqual({ priv: null, keepAlive: null, proxyAuth: null, pub: "fine" });
  });
});
