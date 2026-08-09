// Connecting to an app and completing the WebSocket upgrade: the phase in front
// of a live AppUpstream.
//
// Connect, upgrade, and hand back a live connection — or a failure that the relay
// can turn into an HTTP status, because none of this has happened behind a 101
// yet. That ordering is deliberate and it is what makes an unreachable app a
// clean 502 instead of a WebSocket that opens and immediately dies.
//
// The upgrade is bounded in bytes and in time and validated strictly: status,
// tokenized Connection/Upgrade, exact Sec-WebSocket-Accept, no unsolicited
// extension or subprotocol.

import { connect, type Socket } from "bun";
import { randomBytes } from "crypto";
import { buildHandshakeRequest, checkHandshakeResponse, handshakeAccept } from "./ws-handshake.ts";
import { DEFAULT_UPSTREAM_LIMITS, type AppUpstreamLimits } from "./ws-limits.ts";
import { AppUpstream, type AppUpstreamHandlers } from "./ws-upstream.ts";

const EMPTY = Buffer.alloc(0);

export interface AppUpstreamOptions extends AppUpstreamHandlers {
  port: number;
  // Request target and Host, both already derived from values the office
  // verified — never from a raw request header.
  target: string;
  host: string;
  // Headers the relay decided to forward, after its own hygiene pass.
  headers: Record<string, string>;
  // Subprotocols the browser offered, in order.
  protocols: string[];
  limits?: Partial<AppUpstreamLimits>;
  // TEST SEAM ONLY, and the only one here. Some of this module's contract is
  // about what happens when a socket misbehaves — a connect that never
  // completes, a write the socket only half accepts — and neither can be
  // provoked with a real loopback socket. Production never passes this.
  connector?: typeof connect;
}

export type DialFailure =
  | "connect_failed"
  | "handshake_timeout"
  | "handshake_rejected"
  | "handshake_invalid"
  // The app's 101 named a subprotocol the client never offered. Its own kind so
  // the relay can say what actually went wrong.
  | "handshake_protocol"
  | "bad_request";

export type DialResult = { ok: true; connection: AppUpstream } | { ok: false; failure: DialFailure; detail: string };

// The one place a validation outcome becomes a dial failure, so the two
// vocabularies cannot drift apart as either grows.
const HANDSHAKE_FAILURES: Record<"rejected" | "invalid" | "protocol", DialFailure> = {
  rejected: "handshake_rejected",
  invalid: "handshake_invalid",
  protocol: "handshake_protocol",
};

export async function dialAppUpstream(opts: AppUpstreamOptions): Promise<DialResult> {
  const limits = { ...DEFAULT_UPSTREAM_LIMITS, ...opts.limits };
  const key = randomBytes(16).toString("base64");
  const request = buildHandshakeRequest({ target: opts.target, host: opts.host, key, protocols: opts.protocols, headers: opts.headers });
  if (request === null) {
    return { ok: false, failure: "bad_request", detail: "refusing to build an upgrade request from these values" };
  }
  if (request.length > limits.handshakeMaxRequestBytes) {
    return { ok: false, failure: "bad_request", detail: `upgrade request of ${request.length} bytes is over the ceiling` };
  }
  const expectedAccept = handshakeAccept(key);

  // Handshake state, owned by the closure: the socket's handlers are fixed at
  // connect time, so "which phase are we in" lives here rather than in swapped
  // callbacks.
  let head = EMPTY;
  let connection: AppUpstream | null = null;
  let settled = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  // The socket, as soon as anything has one. Held so the timeout can hang up on
  // a connect that never completes — the case the timer exists for and the one
  // where no handler has fired yet.
  let socketRef: Socket<undefined> | null = null;
  // The part of the request the socket would not take yet. Raw TCP writes are
  // partial (that is why this client exists), and a truncated upgrade request
  // would leave the app waiting for headers that never arrive.
  let requestTail: Buffer | null = null;

  return await new Promise<DialResult>((resolve) => {
    const settle = (result: DialResult): void => {
      if (settled) return;
      settled = true;
      if (timer !== null) clearTimeout(timer);
      timer = null;
      resolve(result);
    };

    // A dial that has already failed may still get callbacks: the timeout can
    // fire before connect completes, and then `open` arrives anyway. Writing the
    // request at that point would start an upgrade nobody is waiting for, and a
    // 101 after it would construct a live connection and call the caller's
    // handlers AFTER the caller was told the dial failed. So every late callback
    // hangs up and does nothing.
    const abandoned = (socket?: Socket<undefined>): boolean => {
      if (!settled || connection !== null) return false;
      try {
        socket?.end();
      } catch {
        // already gone
      }
      return true;
    };

    const failHandshake = (failure: DialFailure, detail: string, socket?: Socket<undefined>): void => {
      // SETTLE FIRST, then hang up. `socket.end()` runs the close handler
      // SYNCHRONOUSLY (measured), and that handler reports its own generic
      // failure — so ending the socket first let "the app closed during the
      // upgrade" overwrite every specific diagnosis this function exists to
      // produce, for every rejection path at once.
      settle({ ok: false, failure, detail });
      try {
        socket?.end();
      } catch {
        // already gone
      }
    };

    // ONE budget for the whole upgrade — the TCP connect, the request, and the
    // response headers — which means it has to start before connect() rather
    // than in `open`. A connect that never completes is otherwise unbounded, and
    // that is the case with no handler to notice it.
    timer = setTimeout(() => {
      failHandshake("handshake_timeout", "no upgrade response within the handshake budget", socketRef ?? undefined);
    }, limits.handshakeTimeoutMs);

    // Write as much of the request as the socket takes, keeping the rest for
    // `drain`. A short write here is unlikely on loopback with a small request,
    // which is precisely why it would be a rare and baffling failure if ignored.
    const writeRequest = (socket: Socket<undefined>, bytes: Buffer): void => {
      let written: number;
      try {
        written = socket.write(bytes);
      } catch (err) {
        failHandshake("connect_failed", `writing the upgrade request failed: ${String(err).slice(0, 120)}`, socket);
        return;
      }
      requestTail = written >= bytes.length ? null : bytes.subarray(written);
    };

    void (opts.connector ?? connect)({
      hostname: "127.0.0.1",
      port: opts.port,
      socket: {
        open(socket) {
          socketRef = socket;
          if (abandoned(socket)) return;
          writeRequest(socket, request);
        },
        data(socket, chunk) {
          if (connection !== null) {
            connection.receive(Buffer.from(chunk));
            return;
          }
          if (abandoned(socket)) return;
          // PHASE BOUNDARY. The response is not even looked at until our request
          // has left in full. A peer that answers early — it has seen the key by
          // then, so it can produce a valid-looking 101 — would otherwise get a
          // connection published while HTTP bytes were still queued behind it,
          // and the next drain would write the tail of an HTTP request into what
          // is now a WebSocket stream. A real server cannot answer before it has
          // the terminator, so this only ever refuses something broken.
          if (requestTail !== null) {
            failHandshake("handshake_invalid", "app answered before the upgrade request had been fully sent", socket);
            return;
          }
          head = head.length === 0 ? Buffer.from(chunk) : Buffer.concat([head, Buffer.from(chunk)]);
          const end = head.indexOf("\r\n\r\n");
          if (end === -1) {
            // Still reading headers — but not forever.
            if (head.length > limits.handshakeMaxHeaderBytes) {
              failHandshake("handshake_invalid", "upgrade response headers over the byte ceiling", socket);
            }
            return;
          }
          // The ceiling applies to the HEADER BLOCK, not to "how long we waited
          // for a terminator". A single read carrying a complete 20KB block plus
          // its terminator is over the limit just as much as 20KB with no
          // terminator yet, and checking only the second case would let the whole
          // thing through — and would then parse it.
          if (end + 4 > limits.handshakeMaxHeaderBytes) {
            failHandshake("handshake_invalid", "upgrade response headers over the byte ceiling", socket);
            return;
          }
          const check = checkHandshakeResponse(head.subarray(0, end).toString("latin1"), expectedAccept, opts.protocols);
          if (!check.ok) {
            failHandshake(HANDSHAKE_FAILURES[check.kind], check.detail, socket);
            return;
          }
          // Frame bytes can share the read that ended the headers, and dropping
          // them would lose an app's first message — which for a server that
          // greets on connect is the only one that matters.
          const leftover = Buffer.from(head.subarray(end + 4));
          head = EMPTY;
          const opened = new AppUpstream({
            socket,
            limits,
            // Wrapped rather than passed by reference: a bare method reference
            // would carry whatever `this` the caller's object had, and this
            // connection calls them for the life of the socket.
            handlers: {
              onMessage: (message) => opts.onMessage(message),
              onClose: (event) => opts.onClose(event),
            },
            protocol: check.protocol,
            leftover,
          });
          // PUBLISH, SETTLE, THEN parse the leftover bytes — in that order. Those
          // bytes can be a close frame or a violation, and handling one ends the
          // connection synchronously; if that happened before `connection` were
          // visible to the socket handlers, the close handler would report
          // "closed during the upgrade" and overwrite the successful handshake we
          // are settling here.
          connection = opened;
          settle({ ok: true, connection: opened });
          opened.begin();
        },
        drain(socket) {
          if (abandoned(socket)) return;
          // The request may still be going out; the connection does not exist
          // until it has.
          if (requestTail !== null) {
            const tail = requestTail;
            requestTail = null;
            writeRequest(socket, tail);
            return;
          }
          connection?.onDrain();
        },
        close() {
          if (connection !== null) {
            connection.onSocketClose();
            return;
          }
          failHandshake("handshake_invalid", "app closed the connection during the upgrade");
        },
        error(_socket, err) {
          if (connection !== null) {
            connection.onSocketError(err);
            return;
          }
          failHandshake("connect_failed", `socket error: ${String(err).slice(0, 120)}`);
        },
      },
    }).catch((err: unknown) => {
      // A refused port rejects here rather than reaching the error handler
      // (measured: ECONNREFUSED). This is the ordinary "the app is not
      // listening" case, and the relay turns it into a refusal the browser can
      // read.
      settle({ ok: false, failure: "connect_failed", detail: `connect failed: ${String(err).slice(0, 120)}` });
    });
  });
}
