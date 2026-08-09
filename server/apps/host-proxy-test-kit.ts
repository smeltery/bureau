// The world the HTTP relay tests run against: a scratch upstream on a real
// loopback socket, an app record pointing at it, and a supervisor that says
// whatever the test wants it to say.
//
// Its own module because the relay is tested from three angles — the bytes it
// carries (host-proxy.test.ts), the content encodings it must not lie about
// (host-proxy-encoding.test.ts), and what it refuses or reclaims
// (host-proxy-limits.test.ts) — and all three need the same upstream. Nothing
// outside those files imports it.
//
// The upstream is on an EPHEMERAL port rather than a registered app's: the
// questions these tests ask are about the relay itself, and answering them
// through the registry would mean binding ports in the production 21000-21999
// window for no extra coverage.
//
// The supervisor is a STUB, never the production singleton: systemd is
// machine-global, so a test that reached the real one would ask about units
// belonging to whatever office owns the box.

import { brotliCompressSync, gzipSync } from "zlib";
import type { AppRecord } from "../../shared/apps.ts";
import { relayToApp } from "./host-proxy.ts";
import type { AppRuntime, AppSupervisor } from "./supervisor.ts";

export const APP_HOST = "hello.office.example";

export const GZIP_TEXT = "compressed ".repeat(40);
export const BINARY = new Uint8Array(1024);
for (let i = 0; i < BINARY.length; i++) BINARY[i] = (i * 31) % 256;

// What the scratch upstream saw, so a test can assert on the request the APP
// got rather than only on the response the browser got.
export interface SeenRequest {
  method: string;
  path: string;
  headers: Record<string, string | undefined>;
  body: string;
}

export interface Upstream {
  port: number;
  seen: SeenRequest[];
  // Requests whose handler observed an abort — the only proof that a client
  // hanging up reached the app rather than being swallowed by the relay.
  aborted: string[];
  stop(): void;
}

export function startUpstream(): Upstream {
  const seen: SeenRequest[] = [];
  const aborted: string[] = [];
  const server = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    idleTimeout: 0,
    async fetch(req) {
      const url = new URL(req.url);
      const path = url.pathname;
      const headers: Record<string, string | undefined> = {};
      for (const [k, v] of req.headers) headers[k.toLowerCase()] = v;
      const wantsBody = req.method !== "GET" && req.method !== "HEAD";
      const body = wantsBody ? await req.text() : "";
      seen.push({ method: req.method, path, headers, body });

      switch (path) {
        case "/binary":
          return new Response(BINARY, { headers: { "Content-Type": "application/octet-stream" } });
        case "/echo":
          return new Response(body, { headers: { "Content-Type": "text/plain; charset=utf-8" } });
        case "/gzip": {
          const gz = gzipSync(Buffer.from(GZIP_TEXT));
          return new Response(gz, { headers: { "Content-Encoding": "gzip", "Content-Length": String(gz.length), "Content-Type": "text/plain" } });
        }
        case "/brotli": {
          const br = brotliCompressSync(Buffer.from(GZIP_TEXT));
          return new Response(br, { headers: { "Content-Encoding": "br", "Content-Length": String(br.length) } });
        }
        case "/shouty-gzip": {
          // `GZIP` is a legal spelling that Bun does NOT decode: the body
          // arrives here still compressed, so the encoding headers are the
          // app's own truth and must survive.
          const gz = gzipSync(Buffer.from(GZIP_TEXT));
          return new Response(gz, { headers: { "Content-Encoding": "GZIP", "Content-Length": String(gz.length) } });
        }
        case "/opaque-coding":
          // An encoding Bun does not decode: the bytes and both headers are
          // the app's own and must arrive untouched.
          return new Response("rawbytes", { headers: { "Content-Encoding": "foo", "Content-Length": "8" } });
        case "/head-gzip":
          // HEAD metadata describes the GET representation. There is no body,
          // so nothing was decoded and nothing may be rewritten.
          return new Response(null, { headers: { "Content-Encoding": "gzip", "Content-Length": "12345", "Content-Type": "text/html" } });
        case "/304":
          return new Response(null, { status: 304, headers: { ETag: '"v1"', "Content-Encoding": "gzip", "Content-Length": "4321" } });
        case "/204":
          return new Response(null, { status: 204 });
        case "/cookies": {
          const h = new Headers();
          // Two field lines, the first with an Expires date — which contains a
          // comma, so a relay that folds them into one string produces one
          // malformed cookie instead of two good ones.
          h.append("Set-Cookie", "sid=abc; Expires=Wed, 09 Jun 2027 10:18:14 GMT; Path=/");
          h.append("Set-Cookie", "theme=dark; Path=/; SameSite=Lax");
          return new Response("ok", { headers: h });
        }
        case "/redirect":
          return new Response(null, { status: 302, headers: { Location: "/somewhere-else" } });
        case "/hop":
          return new Response("ok", {
            headers: { Connection: "X-Private, keep-alive", "X-Private": "secret", "Keep-Alive": "timeout=5", "Proxy-Authenticate": "Basic", "X-Public": "fine" },
          });
        case "/slow-headers":
          await Bun.sleep(2000);
          return new Response("late");
        case "/stall": {
          const stream = new ReadableStream<Uint8Array>({
            async start(controller) {
              controller.enqueue(new TextEncoder().encode("first\n"));
              // ...and then nothing, ever. The client is still attached and
              // the connection is alive: exactly what abort propagation cannot
              // see.
              await new Promise(() => {});
            },
          });
          return new Response(stream);
        }
        case "/sse": {
          const stream = new ReadableStream<Uint8Array>({
            async start(controller) {
              req.signal.addEventListener("abort", () => aborted.push(path));
              try {
                for (let i = 0; i < 50; i++) {
                  controller.enqueue(new TextEncoder().encode(`data: ${i}\n\n`));
                  await Bun.sleep(30);
                }
                controller.close();
              } catch {
                // The consumer went away mid-stream; nothing to do.
              }
            },
            cancel() {
              aborted.push(path);
            },
          });
          return new Response(stream, { headers: { "Content-Type": "text/event-stream" } });
        }
        default:
          return new Response("ok", { headers: { "Content-Type": "text/plain" } });
      }
    },
  });
  return {
    port: server.port as number,
    seen,
    aborted,
    stop: () => {
      void server.stop(true);
    },
  };
}

export function appRecord(port: number, over: Partial<AppRecord> = {}): AppRecord {
  return {
    name: "hello",
    hostLabel: "hello",
    hostGen: 1,
    port,
    command: "bun run serve.ts",
    cwd: "/tmp",
    dataDir: "/tmp/hello",
    userId: "u1",
    username: "Boss",
    createdBy: "Boss",
    createdAt: 1,
    ...over,
  };
}

// A supervisor that answers ONE question — what state is this app in — and
// throws on everything else. The relay is only allowed to ask that one, and a
// throw is how a test finds out if that ever stops being true.
function stubSupervisor(runtimes: Map<string, AppRuntime>): AppSupervisor {
  const refuse = (name: string): never => {
    throw new Error(`host-proxy tests must not call supervisor.${name}()`);
  };
  return {
    states: (names: readonly string[]) => new Map(names.filter((name) => runtimes.has(name)).map((name) => [name, runtimes.get(name)!])),
    unitName: () => refuse("unitName"),
    install: () => refuse("install"),
    provisionToken: () => refuse("provisionToken"),
    readToken: () => refuse("readToken"),
    removeToken: () => refuse("removeToken"),
    unitInjectsToken: () => refuse("unitInjectsToken"),
    readUnitFile: () => refuse("readUnitFile"),
    restoreUnitFile: () => refuse("restoreUnitFile"),
    reloadUnits: () => refuse("reloadUnits"),
    regenerate: () => refuse("regenerate"),
    reinstall: () => refuse("reinstall"),
    teardown: () => refuse("teardown"),
    start: () => refuse("start"),
    stop: () => refuse("stop"),
    restart: () => refuse("restart"),
    logs: () => refuse("logs"),
  };
}

export interface RelayOpts {
  app: AppRecord;
  // What systemd would report for the app. `missing` is no entry at all.
  state?: AppRuntime["state"] | "missing";
  supervisorThrows?: boolean;
  peer?: () => string | null | undefined;
  ttfbMs?: number;
  stallMs?: number;
  maxPerApp?: number;
  maxTotal?: number;
}

// The relay under test, with a supervisor that says what the test wants it to
// say.
export function relay(req: Request, opts: RelayOpts): Promise<Response> {
  const runtimes = new Map<string, AppRuntime>();
  if (opts.state !== "missing") {
    runtimes.set(opts.app.name, { state: opts.state ?? "running", restartCount: 0 });
  }
  const base = stubSupervisor(runtimes);
  const supervisor: AppSupervisor = opts.supervisorThrows
    ? {
        ...base,
        states: () => {
          throw new Error("systemctl unavailable");
        },
      }
    : base;
  return relayToApp(req, {
    app: opts.app,
    host: APP_HOST,
    apps: [opts.app],
    supervisor,
    peer: opts.peer,
    ttfbMs: opts.ttfbMs,
    stallMs: opts.stallMs,
    maxPerApp: opts.maxPerApp,
    maxTotal: opts.maxTotal,
  });
}

export function get(path: string, init: RequestInit = {}): Request {
  return new Request(`https://${APP_HOST}${path}`, init);
}
