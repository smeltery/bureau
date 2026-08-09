// The WebSocket relay behind app hostnames: the entry point in front of the 101,
// and the socket callbacks the office's shared websocket handlers route to.
//
// The upstream half — a frame codec and an in-house client over a raw TCP socket,
// with a queue that has a number on it — lives in host-ws-frames.ts,
// host-ws-decoder.ts, host-ws-upstream.ts and host-ws-dial.ts. This module is the
// wiring: it decides who may open a socket to an app, dials the app, and hands
// the result to the runtime.
//
// WHAT THIS OWNS THAT NEITHER LEG DOES: the order of the checks in front of the
// 101. The lifecycle after it belongs to AppWsRelay in host-ws-relay-socket.ts.
//
// ORDERING, and it is the whole reason a dial can fail cleanly: the app is
// dialed BEFORE the browser is upgraded. Everything that can go wrong with the
// app — not running, not listening, not speaking WebSocket — is therefore still
// an ordinary HTTP refusal with a readable body, rather than a socket that opens
// and dies a millisecond later for reasons the browser cannot see. Measured on
// Bun 1.3.11: `server.upgrade()` still works after an `await` inside `fetch`,
// which is what makes that ordering available at all.

import type { ServerWebSocket } from "bun";
import type { AppRecord } from "../../../shared/apps.ts";
import { buildUpstreamHeaders } from "./proxy-headers.ts";
import { proveAppRunning } from "./proxy.ts";
import { readAppCookie } from "./auth-cookie.ts";
import { APP_BUSY_BODY, APP_UNREACHABLE_BODY, APP_WS_BAD_ORIGIN_BODY, APP_WS_PROTOCOL_MISMATCH_BODY, APP_WS_UPGRADE_FAILED_BODY, BAD_REQUEST_BODY, neutral } from "./responses.ts";
import { dialAppUpstream } from "./ws-dial.ts";
import { APP_WS_MAX_SOCKETS_PER_APP, APP_WS_MAX_SOCKETS_TOTAL, acquireSocketPermit, permitKey } from "./ws-relay-permits.ts";
import { PreOpenBuffer } from "./ws-relay-preopen.ts";
import { CLOSE_BACKPRESSURE, goingAway, originAllowed, parseOfferedProtocols } from "./ws-relay-rules.ts";
import { APP_WS_BROWSER_BUFFER_MAX_BYTES, APP_WS_SESSION_RECHECK_MS } from "./ws-relay-session.ts";
import { AppWsRelay } from "./ws-relay-socket.ts";
import type { AppUpstreamLimits } from "./ws-limits.ts";
import type { UpstreamCloseEvent } from "./ws-upstream.ts";
import { appRegistry as productionRegistry, type AppRegistry } from "../registry.ts";
import type { AppSupervisor } from "../supervisor.ts";

export { APP_WS_BROWSER_BUFFER_MAX_BYTES, APP_WS_SESSION_RECHECK_MS } from "./ws-relay-session.ts";
export { AppWsRelay } from "./ws-relay-socket.ts";
export { APP_WS_MAX_PROTOCOL_HEADER_BYTES, originAllowed, parseOfferedProtocols } from "./ws-relay-rules.ts";
export { APP_WS_MAX_SOCKETS_PER_APP, APP_WS_MAX_SOCKETS_TOTAL, _testResetWsRelay, _testWsSocketsOpen } from "./ws-relay-permits.ts";

export interface AppWsRelayContext {
  app: AppRecord;
  host: string;
  // The SAME registry snapshot the arm matched the label against. Passed in
  // rather than re-read: a second read is a second answer, and it is also what
  // makes the supervisor's state cache hit.
  apps: readonly AppRecord[];
  // The supervisor to ask, INJECTED — never the production singleton reached for
  // from in here, so a test drives the same code path with a fake machine.
  supervisor: AppSupervisor;
  peer?: () => string | null | undefined;
  // Hands the request to the runtime, with the headers that must ride the 101.
  // A thunk rather than the Bun server itself, so this module cannot reach
  // anything else on it and a test can watch the call without a listener.
  //
  // The HEADERS argument is load-bearing rather than decorative: without it the
  // runtime answers the subprotocol negotiation on its own (with the first
  // protocol the client offered — measured), and the app's actual selection is
  // silently replaced by a guess.
  upgrade: (req: Request, data: AppRelayWsData, headers?: Headers) => boolean;
  registry?: AppRegistry;
  // Test seams. Same shape as the HTTP relay's: a cap provable in three sockets
  // rather than sixty-five, a revalidation observable in milliseconds.
  maxPerApp?: number;
  maxTotal?: number;
  bufferMaxBytes?: number;
  recheckMs?: number;
  upstreamLimits?: Partial<AppUpstreamLimits>;
}

// --- the office's websocket callbacks ----------------------------------------

// What rides on the Bun socket. `kind` is the discriminant the office's shared
// websocket handlers switch on: one Bun.serve serves the office and every app
// host, so its three callbacks have to be able to tell a browser talking to the
// office from a browser talking through the relay. It is a field rather than a
// guess about which properties exist — an app-relay socket carries no office
// session at all, and there must be no shape in which one could be mistaken for
// the other.
export interface AppRelayWsData {
  kind: "app";
  relay: AppWsRelay;
}

// One `Bun.serve` serves the office AND every app hostname, and a Bun server has
// exactly one set of websocket callbacks — so those callbacks receive both kinds
// of socket and have to tell them apart before anything else runs. This is that
// test, and the three functions below are everything an app-relay socket needs:
// NOTHING of the office's own machinery runs for one — no roster, no presence, no
// command parsing.
export function isAppRelaySocket(data: unknown): data is AppRelayWsData {
  return typeof data === "object" && data !== null && (data as { kind?: unknown }).kind === "app";
}

export function openAppRelaySocket(ws: ServerWebSocket<AppRelayWsData>): void {
  ws.data.relay.attachBrowser(ws);
}

export function appRelaySocketMessage(ws: ServerWebSocket<AppRelayWsData>, data: string | Buffer): void {
  ws.data.relay.browserMessage(typeof data === "string" ? data : Buffer.from(data));
}

export function closeAppRelaySocket(ws: ServerWebSocket<AppRelayWsData>, code: number, reason: string): void {
  ws.data.relay.browserClosed(code, reason);
}

// --- the entry point ---------------------------------------------------------

// An upgrade on an app host. Returns a Response for every refusal, and
// `undefined` exactly when the socket was handed to the runtime — which is what
// Bun's fetch handler wants back from an upgraded request.
//
// The order below is the security argument, and each step is placed where it is
// for a reason the comment gives. Nothing that can refuse cheaply happens after
// something expensive, and nothing that touches the app happens before the
// caller has proven they may.
export async function relayWsToApp(req: Request, ctx: AppWsRelayContext): Promise<Response | undefined> {
  // 1. Auth has already happened: the arm runs appHostWsAuthGate ahead of this,
  // in the same position the HTTP path runs its gate, and nothing reaches here
  // without a live app session. The cookie is read again for one reason — the
  // revalidation timer has to ask the same question every thirty seconds.
  const rawCookie = readAppCookie(req);

  // 2. Origin. Cheap, and it fails a cross-origin attempt before the app hears
  // about it at all. A browser can be made to open a WebSocket cross-site, so
  // the relay is what decides, not the app.
  if (!originAllowed(req.headers.get("origin"), ctx.host)) {
    return neutral(403, APP_WS_BAD_ORIGIN_BODY);
  }

  // 3. The browser's subprotocol offer, parsed strictly — see
  // parseOfferedProtocols for why a malformed list cannot be treated as none.
  const offered = parseOfferedProtocols(req.headers.get("sec-websocket-protocol"));
  if (offered === null) return neutral(400, BAD_REQUEST_BODY);

  // 4. The app is running, proven by the SAME helper the HTTP relay uses and in
  // the same position in the sequence, so the two cannot drift. No socket is
  // opened to a port whose app is not running, because that port is just a port.
  const running = proveAppRunning(ctx);
  if (!running.ok) return running.response;

  // 5. A permit from the WebSocket pool, taken in this synchronous turn.
  const permit = acquireSocketPermit(permitKey(ctx.app), { perApp: ctx.maxPerApp ?? APP_WS_MAX_SOCKETS_PER_APP, total: ctx.maxTotal ?? APP_WS_MAX_SOCKETS_TOTAL });
  if (permit === null) return neutral(429, APP_BUSY_BODY);

  // 6. Dial the app. Everything below is `await`ed, which is exactly why the
  // permit is already held: the slot is occupied from the moment the dial starts
  // rather than from the moment it succeeds.
  const url = new URL(req.url);
  const headers: Record<string, string> = {};
  // ONE hygiene builder, shared with the HTTP relay (host-proxy-headers.ts):
  // hop-by-hop headers and the
  // ones a `Connection` line nominates are dropped, the relay-owned
  // `X-Forwarded-*` are rewritten rather than passed through, `Host` is the
  // verified app host, and the Cookie header loses all three bureau credentials
  // (the app must never see what admits to it). The upstream client then owns
  // every header that belongs to the handshake itself — key, version, Connection,
  // Upgrade, and the protocol offer — and drops any inbound duplicate of them.
  for (const [name, value] of buildUpstreamHeaders(req, ctx.host, peerAddress(ctx))) {
    headers[name] = value;
  }

  // THE EARLIEST WINDOW, and it is narrower and sharper than the pre-open one
  // inside the relay. The upstream client publishes the connection, settles the
  // dial, and only THEN parses the bytes that shared the handshake's last TCP
  // read — so an app that greets on connect can deliver its greeting, or its
  // close, while this function is still suspended on the `await` and no relay
  // object exists yet. Dropping those would lose the first message of every
  // server that speaks first, which for a greeting protocol is the only message
  // that matters.
  let relay: AppWsRelay | null = null;
  const bufferMaxBytes = ctx.bufferMaxBytes ?? APP_WS_BROWSER_BUFFER_MAX_BYTES;
  const early = new PreOpenBuffer(bufferMaxBytes);
  let earlyClose: UpstreamCloseEvent | null = null;

  const dial = await dialAppUpstream({
    port: ctx.app.port,
    // Path and query verbatim, from the URL the arm already parsed.
    target: `${url.pathname}${url.search}`,
    host: ctx.host,
    headers,
    protocols: offered,
    limits: ctx.upstreamLimits,
    onMessage: (message) => {
      if (relay !== null) {
        relay.onUpstreamMessage(message);
        return;
      }
      // The same buffer, with the same check-before-retain rule, as the relay's
      // own pre-open window: the ceiling is a bound, not an observation made
      // afterwards.
      early.add(message);
    },
    onClose: (event) => {
      if (relay !== null) {
        relay.onUpstreamClose(event);
        return;
      }
      earlyClose = event;
    },
  });
  if (!dial.ok) {
    console.error(`[app-ws-relay] ${ctx.app.hostLabel}: upstream dial failed (${dial.failure}): ${dial.detail}`);
    permit.release();
    // One answer for every way an app can fail to be reached — refused the
    // connection, took too long, answered a page instead of an upgrade, got the
    // handshake wrong. The caller cannot act differently on the difference, and
    // the difference is a fact about a process on this box.
    //
    // EXCEPT the subprotocol one, which the caller CAN act on: their own client
    // asked for an application protocol this app did not agree to. That gets the
    // body that says so.
    return dial.failure === "handshake_protocol" ? neutral(502, APP_WS_PROTOCOL_MISMATCH_BODY) : neutral(502, APP_UNREACHABLE_BODY);
  }

  // 7. The subprotocol the app selected has to be what the browser is told —
  // matched or refused, never half-agreed.
  //
  // Bun answers with the FIRST protocol the client offered unless we set the
  // header ourselves (measured), so leaving this to the runtime would let the
  // two legs disagree about the application protocol — the browser framing one
  // way while the app speaks another.
  const responseHeaders = new Headers();
  if (dial.connection.protocol !== null) {
    responseHeaders.set("Sec-WebSocket-Protocol", dial.connection.protocol);
  } else if (offered.length > 0) {
    // The app selected NONE while the browser offered some. Bun cannot be told
    // to answer "none" — an empty header value emits two protocol lines, and the
    // offer is read from the raw request, so deleting it off the Request changes
    // nothing (all measured) — so the only alternative to refusing is letting
    // the runtime claim an agreement that never happened. Refused;
    // host-responses.ts carries the reasoning with the body. The socket to the
    // app is ended here rather than left for the finalizer, because no relay
    // object exists yet to own it.
    dial.connection.terminate("no subprotocol agreed");
    permit.release();
    return neutral(502, APP_WS_PROTOCOL_MISMATCH_BODY);
  }

  relay = new AppWsRelay(dial.connection, permit, { token: rawCookie, app: ctx.app, registry: ctx.registry ?? productionRegistry }, bufferMaxBytes, ctx.recheckMs ?? APP_WS_SESSION_RECHECK_MS);

  // Whatever arrived during the dial is handed over now, in order, before the
  // upgrade — so it lands in the relay's own pre-open buffer and reaches the
  // browser the moment there is one.
  if (early.overflow()) {
    // The app blasted more than the whole browser-leg ceiling in the turn or two
    // before the socket could be upgraded. Those bytes are gone — there was
    // nowhere to put them — so there is nothing to deliver and no honest way to
    // open a socket that has already lost data. Refused as a capacity problem,
    // which is what it is, rather than as "did not respond", which it is not.
    relay.finish(
      // The app hears the backpressure code rather than a generic goodbye: it is
      // the one that overran the ceiling. No browser leg exists to tell.
      { browser: null, upstream: { code: CLOSE_BACKPRESSURE, reason: "app is too fast" } },
      "the app sent more than the buffer ceiling before the upgrade",
    );
    return neutral(503, APP_BUSY_BODY);
  }
  for (const message of early.take()) relay.onUpstreamMessage(message);
  // A close that arrived during the dial is recorded, not acted on: the upgrade
  // still happens and the browser gets the app's messages and then its close
  // code. See onUpstreamClose for why that beats refusing.
  if (earlyClose !== null) relay.onUpstreamClose(earlyClose);

  // 8. THE SYNCHRONOUS RE-CHECK. Everything from the dial resolving to the
  // upgrade call is ONE synchronous block — construction, the early-close
  // handling, the replay, this check — so nothing can currently finish a relay
  // in between and this guard catches nothing today. It stays anyway, because
  // the alternative is a rule that holds by accident: the moment an await, or a
  // runtime that hands over a transport differently, appears in this stretch, a
  // dead relay would silently be handed a 101. Stated rather than implied, so
  // nobody reads it as tested behavior.
  if (!relay.isLive()) return neutral(502, APP_UNREACHABLE_BODY);

  // MARKED BEFORE THE CALL, not after: the runtime can own a browser transport
  // at any point inside it, and on Bun 1.3.11 it runs the socket's `open`
  // handler before returning. See beginUpgrade.
  relay.beginUpgrade();
  let upgraded: boolean;
  try {
    upgraded = ctx.upgrade(req, { kind: "app", relay }, responseHeaders.has("Sec-WebSocket-Protocol") ? responseHeaders : undefined);
  } catch (err) {
    // An exceptional runtime seam is the one path where a permit and a live
    // upstream socket could leak silently, so it is handled exactly like a
    // refusal rather than propagated.
    console.error(`[app-ws-relay] ${ctx.app.hostLabel}: upgrade threw:`, err);
    relay.upgradeRejected();
    relay.finish(goingAway("office closed the socket"), "the runtime threw on upgrade");
    return neutral(500, APP_WS_UPGRADE_FAILED_BODY);
  }
  if (!upgraded) {
    relay.upgradeRejected();
    relay.finish(goingAway("office closed the socket"), "the runtime refused the upgrade");
    return neutral(500, APP_WS_UPGRADE_FAILED_BODY);
  }
  // Nothing to mark and nothing to return: the socket is the runtime's now, and
  // anything written here would be written AFTER a synchronous close callback
  // may already have run.
  return undefined;
}

function peerAddress(ctx: AppWsRelayContext): string | null {
  try {
    return ctx.peer?.() ?? null;
  } catch {
    return null;
  }
}
