// Shared rigs for the app-host WebSocket relay's tests: real Bun apps, raw TCP
// peers that can express what Bun cannot, a fake socket for the two contract
// points a real loopback socket cannot exhibit, and a fake browser leg.
//
// Nothing here asserts anything. It exists so each test file can be about one
// property of the relay rather than about how to stand a peer up.

import type { Socket, TCPSocketListener } from "bun";
import { createHash } from "crypto";
import { dialAppUpstream } from "../host/ws-dial.ts";
import type { UpstreamCloseEvent } from "../host/ws-upstream.ts";

export const WS_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";

export function defaultAccept(key: string): string {
  return createHash("sha1")
    .update(key + WS_GUID)
    .digest("base64");
}

// A valid 101 header block, as bytes, for the tests that need it concatenated
// with frame data.
export function upgradeHead(accept: string, extra: string[] = []): Buffer {
  return Buffer.from(["HTTP/1.1 101 Switching Protocols", "Upgrade: websocket", "Connection: Upgrade", `Sec-WebSocket-Accept: ${accept}`, ...extra, "", ""].join("\r\n"), "latin1");
}

// Bun types a server's `port` as optional, since a unix-socket server has none.
// Every server here is a TCP one on an ephemeral port, so the assertion happens
// once instead of at each call site.
export function portOf(server: { port?: number | null }): number {
  if (server.port === null || server.port === undefined) {
    throw new Error("test server has no port");
  }
  return server.port;
}

// Poll rather than sleep a fixed time: Bun's WS server delivers on its own
// schedule, and a fixed sleep is either flaky or slow.
export async function until(predicate: () => boolean, what: string, timeoutMs = 2000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await Bun.sleep(5);
  }
}

// Fill the write queue until it refuses, with a HARD byte budget.
//
// `while (send() === "sent")` is the obvious way to write this and it is a
// memory bomb: the loop only ends because a ceiling says so, so any change that
// breaks the ceiling — a refactor, or a mutation cycle deliberately removing it —
// turns the test into an unbounded allocator. A bounded loop that ASSERTS it
// filled fails in milliseconds instead, which is what a test is for.
//
// BYTE-budgeted, not iteration-budgeted: 4096 sends of 64KB is a quarter of a
// gigabyte before anything complains, which is the wrong order of magnitude for
// "this test noticed the ceiling is gone".
export function fillQueue(send: () => string, what: string, frameBytes: number, byteBudget = 16 * 1024 * 1024): number {
  const maxSends = Math.max(4, Math.ceil(byteBudget / Math.max(frameBytes, 1)));
  for (let i = 0; i < maxSends; i++) {
    if (send() !== "sent") return i;
  }
  throw new Error(`${what}: queue never refused after ${maxSends} sends (${Math.round((maxSends * frameBytes) / 1024)}KB attempted) - the ceiling is not holding`);
}

// --- a real WebSocket app ----------------------------------------------------

export interface AppSeen {
  frames: string[];
  closes: { code: number; reason: string }[];
  pongs: string[];
  upgradeHeaders: Record<string, string>[];
}

export function appSeen(): AppSeen {
  return { frames: [], closes: [], pongs: [], upgradeHeaders: [] };
}

// A real Bun WebSocket app: echoes text with a prefix, echoes binary verbatim,
// and takes instructions through the frames it receives. Bun's own server
// implementation, deliberately — the client leg is the office's codec, so the app
// leg being someone else's code is what keeps an echo honest.
export function startApp(seen: AppSeen, opts: { greet?: string; port?: number } = {}): ReturnType<typeof Bun.serve<undefined>> {
  return Bun.serve<undefined>({
    port: opts.port ?? 0,
    hostname: "127.0.0.1",
    fetch(req, server) {
      const headers: Record<string, string> = {};
      for (const [k, v] of req.headers) headers[k] = v;
      seen.upgradeHeaders.push(headers);
      const offered = (req.headers.get("sec-websocket-protocol") ?? "")
        .split(",")
        .map((p) => p.trim())
        .filter(Boolean);
      const chosen = offered[0];
      const ok = server.upgrade(req, { data: undefined, ...(chosen ? { headers: { "Sec-WebSocket-Protocol": chosen } } : {}) });
      return ok ? undefined : new Response("no upgrade", { status: 400 });
    },
    websocket: {
      open(ws) {
        if (opts.greet !== undefined) ws.send(opts.greet);
      },
      message(ws, data) {
        if (typeof data !== "string") {
          seen.frames.push(`binary:${Buffer.from(data).toString("hex")}`);
          ws.send(data);
          return;
        }
        seen.frames.push(data);
        if (data === "close-4321") return void ws.close(4321, "app said bye");
        if (data === "close-plain") return void ws.close();
        if (data === "ping-me") return void ws.ping("app-ping-payload");
        // Over the client's message cap in the test that asks for it.
        if (data === "big") return void ws.send("Z".repeat(5000));
        ws.send(`echo:${data}`);
      },
      pong(_ws, data) {
        seen.pongs.push(Buffer.from(data).toString());
      },
      close(_ws, code, reason) {
        seen.closes.push({ code, reason });
      },
    },
  });
}

// --- a hand-written TCP peer -------------------------------------------------

// `onUpgraded` decides what it does after the 101 (or `respond` replaces the
// whole response, for the invalid-handshake cases).
export interface PeerOptions {
  respond?: (request: string) => string | null;
  // A raw response, so the 101 and a frame can be put in ONE write — the only
  // way to guarantee they arrive in one read.
  respondBytes?: (request: string, accept: string) => Buffer;
  splitLastByte?: boolean;
  accept?: (key: string) => string;
  extraResponseHeaders?: string[];
  onUpgraded?: (socket: Socket<undefined>) => void;
  stopReading?: boolean;
  port?: number;
}

export function startPeer(opts: PeerOptions): TCPSocketListener<undefined> {
  return Bun.listen<undefined>({
    hostname: "127.0.0.1",
    port: opts.port ?? 0,
    socket: {
      data(socket, chunk) {
        const request = Buffer.from(chunk).toString("latin1");
        if (!request.startsWith("GET ")) return; // frames; ignore
        if (opts.respond !== undefined) {
          const response = opts.respond(request);
          if (response !== null) socket.write(response);
          return;
        }
        if (opts.respondBytes !== undefined) {
          const k = /sec-websocket-key: (.*)\r\n/i.exec(request)?.[1]?.trim() ?? "";
          const bytes = opts.respondBytes(request, defaultAccept(k));
          if (opts.splitLastByte) {
            // Hold back the final byte of the terminator, then send it alone, so
            // the client sees the header block end in a SECOND read.
            socket.write(bytes.subarray(0, bytes.length - 1));
            setTimeout(() => socket.write(bytes.subarray(bytes.length - 1)), 20);
          } else {
            socket.write(bytes);
          }
          return;
        }
        const key = /sec-websocket-key: (.*)\r\n/i.exec(request)?.[1]?.trim() ?? "";
        const accept = (opts.accept ?? defaultAccept)(key);
        socket.write(["HTTP/1.1 101 Switching Protocols", "Upgrade: websocket", "Connection: Upgrade", `Sec-WebSocket-Accept: ${accept}`, ...(opts.extraResponseHeaders ?? []), "", ""].join("\r\n"));
        if (opts.stopReading) socket.pause();
        opts.onUpgraded?.(socket);
      },
      open() {},
      close() {},
      error() {},
    },
  });
}

// A raw app that answers the handshake by hand: the subprotocol cases exist
// BECAUSE Bun cannot express them — a Bun app asked for a subprotocol answers
// with the first one offered whether it meant to or not, so "the app selected
// none" is unbuildable with it. `silent` answers NOTHING after the 101, which is
// how the app leg is held physically open after the office initiates a close.
export function startRawApp(
  opts: {
    port?: number;
    protocolLine?: (offered: string | null) => string | null;
    // A close frame with NO status code (0x88 0x00), or one carrying 4001.
    closeWithNoStatus?: boolean;
    closeOnConnect?: boolean;
    // An unmasked text frame of this many bytes, in the SAME write as the 101.
    greetBytes?: number;
  } = {},
): { stop(): void; ended(): number; port: number } {
  let ended = 0;
  const srv = Bun.listen<undefined>({
    hostname: "127.0.0.1",
    port: opts.port ?? 0,
    socket: {
      data(socket, chunk) {
        const head = Buffer.from(chunk).toString("latin1");
        if (!head.startsWith("GET ")) return; // ignore frames entirely
        const key = /sec-websocket-key:\s*(\S+)/i.exec(head)?.[1] ?? "";
        const offered = /sec-websocket-protocol:\s*([^\r\n]+)/i.exec(head)?.[1] ?? null;
        const protocolLine = opts.protocolLine?.(offered) ?? null;
        const parts: Buffer[] = [upgradeHead(defaultAccept(key), protocolLine === null ? [] : [`Sec-WebSocket-Protocol: ${protocolLine}`])];
        // A greeting comes BEFORE any close, in the order an app that speaks
        // first would write it — and in the SAME write as the 101, so it shares
        // the TCP read that ends the handshake.
        if (opts.greetBytes !== undefined) {
          const payload = Buffer.alloc(opts.greetBytes, 0x61);
          const header = Buffer.alloc(4);
          header[0] = 0x81;
          header[1] = 126;
          header.writeUInt16BE(payload.length, 2);
          parts.push(header, payload);
        }
        if (opts.closeWithNoStatus) parts.push(Buffer.from([0x88, 0x00]));
        if (opts.closeOnConnect) {
          const payload = Buffer.concat([Buffer.from([0x0f, 0xa1]), Buffer.from("app done", "utf8")]);
          parts.push(Buffer.concat([Buffer.from([0x88, payload.length]), payload]));
        }
        socket.write(Buffer.concat(parts));
      },
      close() {
        ended++;
      },
    },
  });
  return { stop: () => srv.stop(true), ended: () => ended, port: srv.port };
}

// --- a fake socket -----------------------------------------------------------

// For the two contract points a real loopback socket cannot be made to exhibit:
// a connect that never completes, and a write the socket only partly accepts.
// The connector seam hands one of these to dialAppUpstream and the test drives
// the handlers itself.
export interface FakeSocket {
  written: Buffer[];
  ended: boolean;
  // Bytes the next write() will accept; -1 means "all of it".
  accept: number;
  write(data: Buffer | string): number;
  end(): void;
}

export function makeFakeConnector(opts: { accept?: number; neverConnect?: boolean; autoUpgrade?: boolean } = {}) {
  const socket: FakeSocket = {
    written: [],
    ended: false,
    accept: opts.accept ?? -1,
    write(data) {
      const bytes = typeof data === "string" ? Buffer.from(data) : Buffer.from(data);
      const take = socket.accept < 0 ? bytes.length : Math.min(socket.accept, bytes.length);
      socket.written.push(bytes.subarray(0, take));
      // Answer the upgrade once the whole request has been written, so a test can
      // work with a LIVE connection over a socket it fully controls.
      if (opts.autoUpgrade && !upgraded) {
        const all = Buffer.concat(socket.written).toString("latin1");
        if (all.includes("\r\n\r\n")) {
          upgraded = true;
          const key = /sec-websocket-key: (.*)\r\n/i.exec(all)?.[1]?.trim() ?? "";
          queueMicrotask(() => handlers?.data?.(socket as never, upgradeHead(defaultAccept(key)) as never));
        }
      }
      return take;
    },
    end() {
      socket.ended = true;
      handlers?.close?.(socket as never);
    },
  };
  let handlers: Record<string, ((...args: never[]) => void) | undefined> | null = null;
  let upgraded = false;
  const connector = (options: { socket: Record<string, ((...args: never[]) => void) | undefined> }): Promise<unknown> => {
    handlers = options.socket;
    if (opts.neverConnect) return new Promise(() => undefined);
    // `open` synchronously, like Bun does once the TCP handshake completes.
    options.socket.open?.(socket as never);
    return Promise.resolve(socket);
  };
  return {
    socket,
    connector: connector as unknown as NonNullable<Parameters<typeof dialAppUpstream>[0]["connector"]>,
    // For the late-callback tests: connect "completing" after the dial gave up.
    openLate: () => handlers?.open?.(socket as never),
    errorNow: (err: unknown) => handlers?.error?.(socket as never, err as never),
    drain: () => handlers?.drain?.(socket as never),
    data: (bytes: Buffer) => handlers?.data?.(socket as never, bytes as never),
    close: () => handlers?.close?.(socket as never),
    writtenBytes: () => Buffer.concat(socket.written),
  };
}

// --- what the dial reports ---------------------------------------------------

export interface Collected {
  messages: { kind: string; body: string }[];
  closes: UpstreamCloseEvent[];
}

export function collector(): Collected {
  return { messages: [], closes: [] };
}

export async function dial(port: number, got: Collected, extra: Partial<Parameters<typeof dialAppUpstream>[0]> = {}): Promise<Awaited<ReturnType<typeof dialAppUpstream>>> {
  return await dialAppUpstream({
    port,
    target: "/socket",
    host: "hello.office.example",
    headers: {},
    protocols: [],
    onMessage(message) {
      got.messages.push(message.kind === "text" ? { kind: "text", body: message.text } : { kind: "binary", body: message.data.toString("hex") });
    },
    onClose(event) {
      got.closes.push(event);
    },
    ...extra,
  });
}
