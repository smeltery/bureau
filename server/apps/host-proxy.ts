// The HTTP relay behind app hostnames.
//
// A request whose Host is a strict child of the office host is diverted before
// any office handler sees it, and a caller who cannot prove an office session
// never gets past the gate. This module is what finally sits at the end of that
// road — an authenticated request is carried to the app's own loopback port and
// its bytes are carried back, streamed both ways.
//
// A relay is a place where two parties' assumptions meet, so nearly all of the
// code here is about NOT passing something along:
//
//   - the app never sees `__Host-bureau_app`, the cookie that admits to it.
//     That is the whole point of the handshake: a program an agent wrote in a
//     scratch directory must not be handed the credential that opens itself,
//     let alone one that opens the office. The two office session cookie names
//     go the same way, for the same money.
//   - the app never sees a client's `X-Forwarded-*`. The relay writes those,
//     and a header the relay owns is worthless if a client can pre-fill it.
//   - the browser never sees the app's hop-by-hop headers, and never sees a
//     `Content-Encoding` describing bytes Bun already decoded on the way in.
//   - nothing at all is sent to an app that is not RUNNING. A stopped app's
//     port is just a free port, and any local process can be sitting on it.
//
// The header rules that carry out the first three live in host-proxy-headers.ts,
// where they can be pinned without a socket.
//
// WebSocket upgrades never reach here — the arm refuses them above this module,
// and the WebSocket relay carries them instead.

import type { AppRecord } from "../../shared/apps.ts";
import { APP_BUSY_BODY, APP_STOPPED_BODY, APP_UNREACHABLE_BODY, neutral } from "./host-responses.ts";
import { buildDownstreamHeaders, buildUpstreamHeaders } from "./host-proxy-headers.ts";
import { acquireRelayPermit } from "./host-proxy-permits.ts";
import type { AppRuntime, AppSupervisor } from "./supervisor.ts";

// The pure header rules and the permit counters, re-exported so a consumer (and
// a test) has ONE import site for the relay and cannot pick up a second
// definition of a stripped cookie name, a decoded coding, or an in-flight count.
export { buildDownstreamHeaders, buildUpstreamHeaders, carriesDecodedCoding, forwardedForValue, stripBureauCookies } from "./host-proxy-headers.ts";
export { _testRelayInFlight, _testResetRelay } from "./host-proxy-permits.ts";

// --- constants (plain named values, no env vars) -----------------------------

// How long the app has to produce RESPONSE HEADERS. Cleared the moment they
// arrive: a stream that then runs for a day is a feature (SSE), so this can
// never become a total-duration cap.
export const APP_RELAY_TTFB_MS = 30_000;

// How long a started response may move no bytes before the relay gives up on
// it. This is the case abort propagation cannot see: the client is still
// attached and the app is still connected, but nothing is coming. It is a
// dead-upstream reclamation bound, not a liveness policy — an app that means to
// hold a stream open across a quiet period (SSE, long-poll) has to send a
// heartbeat inside this window, which is what every SSE implementation does
// anyway. Deliberately generous, because the cost of it being wrong is a
// working stream cut off.
export const APP_RELAY_STALL_MS = 300_000;

// Concurrency, so one app — or one flood at one app — cannot occupy the office's
// whole event loop. Sanity bounds, not a quota anybody should notice.
export const APP_RELAY_MAX_CONCURRENT_PER_APP = 128;
export const APP_RELAY_MAX_CONCURRENT_TOTAL = 512;

// Request-body size is NOT capped here. The listener's own maxRequestBodySize
// already applies — the app-host arm is the same Bun.serve as the office — so a
// second number here would be one more thing to keep consistent with the
// office's own story, buying no behavior it does not already have.

// Statuses defined to carry no body. A `Response` built with one of these and a
// body is a framing error waiting to happen, and there is nothing to stream.
const NULL_BODY_STATUSES = new Set([204, 205, 304]);

// --- the relay ---------------------------------------------------------------

export interface RelayContext {
  // The live app record, and the normalized hostname the arm resolved it from.
  app: AppRecord;
  host: string;
  // The SAME registry snapshot the arm matched the label against. Passed in
  // rather than re-read: a second read is a second answer, and it is also what
  // makes the supervisor's state cache hit (it keys on the exact set of names
  // asked for, and clears itself on a miss).
  apps: readonly AppRecord[];
  supervisor: AppSupervisor;
  // Read once per relayed request, inside a guard: `requestIP` is a socket
  // question, and a socket that has already gone away is not an error case
  // worth failing a response over.
  peer?: () => string | null | undefined;
  // Test seams, so a stall can be provoked in milliseconds instead of five
  // minutes and a cap in two requests instead of five hundred.
  stallMs?: number;
  ttfbMs?: number;
  maxPerApp?: number;
  maxTotal?: number;
}

function peerAddress(ctx: RelayContext): string | null {
  try {
    return ctx.peer?.() ?? null;
  } catch {
    return null;
  }
}

// PROOF THE APP IS UP, before anything opens a socket. Not "proof it is down": a
// missing entry, `activating`, `failed` and `unknown` all refuse, because a port
// whose app is not running is a port anything on this box can be listening on.
// An externally-started app may briefly 503 while systemd reports `activating`,
// which is the right side to be wrong on.
//
// The WHOLE step lives here — the supervisor read, its failure mode, the
// decision, and the bytes of the refusal — rather than as a fragment each relay
// re-assembles. Two relays (HTTP here, and the WebSocket one) have to answer
// this question identically and in the same position in their sequence: before a
// permit, before a socket. A shared boolean would have let the refusal wording
// or the ordering drift apart; a shared decision cannot.
//
// The supervisor is INJECTED, never read from the production singleton: systemd
// is machine-global, so a relay that reached for the real one would answer this
// question against whatever office happens to own the box.
export function proveAppRunning(ctx: { app: AppRecord; apps: readonly AppRecord[]; supervisor: AppSupervisor }): { ok: true } | { ok: false; response: Response } {
  let runtime: AppRuntime | undefined;
  try {
    runtime = ctx.supervisor.states(ctx.apps.map((app) => app.name)).get(ctx.app.name);
  } catch (err) {
    console.error("[app-proxy] supervisor unreadable; refusing app:", err);
    return { ok: false, response: neutral(503, APP_STOPPED_BODY) };
  }
  if (runtime?.state !== "running") {
    return { ok: false, response: neutral(503, APP_STOPPED_BODY) };
  }
  return { ok: true };
}

export async function relayToApp(req: Request, ctx: RelayContext): Promise<Response> {
  // 1. The app is running — proven before anything opens a socket.
  const running = proveAppRunning(ctx);
  if (!running.ok) return running.response;

  // 2. A permit, taken in this same synchronous turn.
  const permit = acquireRelayPermit(ctx.app, {
    perApp: ctx.maxPerApp ?? APP_RELAY_MAX_CONCURRENT_PER_APP,
    total: ctx.maxTotal ?? APP_RELAY_MAX_CONCURRENT_TOTAL,
  });
  if (permit === null) return neutral(429, APP_BUSY_BODY);

  // Everything below releases EXACTLY ONCE, on every path out: a rejected
  // fetch, a bodyless response, the end of the stream, an error in it, the
  // client hanging up, a stall, or a throw nobody expected.
  const ac = new AbortController();
  const onClientGone = (): void => ac.abort();
  // Registered FIRST, then the past checked — `addEventListener` does not replay
  // an abort that already happened, and there is real time between the office
  // receiving this request and here (a state lookup and a permit). A client can
  // be gone by now, and starting an upstream request on its behalf would be work
  // nobody is waiting for. Checking before registering would leave the opposite
  // gap.
  req.signal.addEventListener("abort", onClientGone);
  if (req.signal.aborted) ac.abort();
  let ttfbTimer: ReturnType<typeof setTimeout> | null = null;
  // Set by the body guard, which owns the timer's lifetime; kept here so a
  // release from any other path still cannot leave one armed.
  let disarmStall: (() => void) | null = null;
  let released = false;
  const release = (): void => {
    if (released) return;
    released = true;
    if (ttfbTimer !== null) clearTimeout(ttfbTimer);
    ttfbTimer = null;
    disarmStall?.();
    disarmStall = null;
    req.signal.removeEventListener("abort", onClientGone);
    permit.release();
  };

  try {
    const url = new URL(req.url);
    // Loopback and the registry's own port, always. Nothing from the request
    // decides where this connects.
    const target = `http://127.0.0.1:${ctx.app.port}${url.pathname}${url.search}`;
    const hasRequestBody = req.method !== "GET" && req.method !== "HEAD";

    ttfbTimer = setTimeout(() => ac.abort(), ctx.ttfbMs ?? APP_RELAY_TTFB_MS);
    let upstream: Response;
    try {
      upstream = await fetch(target, {
        method: req.method,
        headers: buildUpstreamHeaders(req, ctx.host, peerAddress(ctx)),
        // Streamed, never buffered: an upload of any size and an SSE response
        // both have to work, and neither can if a body is read into memory
        // first. A `Content-Length` the client sent is preserved above, so the
        // app sees the same framing its caller used; `Transfer-Encoding` is
        // hop-by-hop and was dropped, so there is no ambiguity between them.
        body: hasRequestBody ? req.body : undefined,
        // A 3xx belongs to the browser: following it here would mean the relay
        // deciding where the user goes, and would silently turn one app's
        // redirect into a request the user never made.
        redirect: "manual",
        signal: ac.signal,
      });
    } catch (err) {
      // Nothing has been written downstream yet, so this is the one failure the
      // relay can still report honestly as a status.
      console.error(`[app-proxy] ${ctx.app.hostLabel}: upstream request failed:`, err);
      release();
      return neutral(502, APP_UNREACHABLE_BODY);
    } finally {
      // Headers are in (or will never come). Whatever happens to the body from
      // here is the stall guard's business, not this timer's.
      if (ttfbTimer !== null) clearTimeout(ttfbTimer);
      ttfbTimer = null;
    }

    const bodyless = req.method === "HEAD" || NULL_BODY_STATUSES.has(upstream.status) || upstream.body === null;
    const headers = buildDownstreamHeaders(upstream, {
      // A HEAD or a 304 carries metadata ABOUT a representation it does not
      // contain, so its `Content-Encoding` and `Content-Length` describe bytes
      // Bun never saw, let alone decoded. Rewriting them there would corrupt a
      // cache validation with a length of a body that was never sent.
      rewriteEncoding: !bodyless,
    });

    if (bodyless) {
      // Cancel rather than leave a body half-read holding the connection.
      upstream.body?.cancel().catch(() => {});
      release();
      return new Response(null, { status: upstream.status, headers });
    }

    const guarded = guardBody(upstream.body!, {
      stallMs: ctx.stallMs ?? APP_RELAY_STALL_MS,
      onStall: () => ac.abort(),
      onDone: release,
    });
    disarmStall = guarded.disarm;
    return new Response(guarded.body, { status: upstream.status, headers });
  } catch (err) {
    // Nothing here is expected to throw — header rewriting, taking the reader,
    // building the Response. But if one of them does, the upstream request may
    // already be live, and releasing the permit while leaving it running would
    // be accounting that has lost track of a real connection. Abort first.
    console.error(`[app-proxy] ${ctx.app.hostLabel}: relay failed:`, err);
    ac.abort();
    release();
    return neutral(502, APP_UNREACHABLE_BODY);
  }
}

// The response body, with a timer that resets on every chunk.
//
// Once these bytes are on the wire the status is spent: a connection reset
// halfway through a 200 cannot be retroactively turned into a 502, and pretending
// otherwise would mean buffering the whole response to find out. So a failure
// here terminates the stream and the client sees a truncated response, which is
// exactly what it is — the same thing it would see from the app directly.
function guardBody(upstream: ReadableStream<Uint8Array>, opts: { stallMs: number; onStall: () => void; onDone: () => void }): { body: ReadableStream<Uint8Array>; disarm: () => void } {
  const reader = upstream.getReader();
  let timer: ReturnType<typeof setTimeout> | null = null;
  const disarm = (): void => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
  };
  // Always through disarm first: an armed timer that is merely forgotten still
  // fires, and would abort a stream that is running perfectly well.
  const arm = (): void => {
    disarm();
    timer = setTimeout(opts.onStall, opts.stallMs);
  };
  const finish = (): void => {
    disarm();
    opts.onDone();
  };
  const body = new ReadableStream<Uint8Array>({
    // ARMED ONLY ACROSS A PENDING READ, which is the whole distinction this
    // guard has to draw. "The app has produced nothing" and "the client has not
    // consumed what the app produced" look identical from a timer that runs
    // continuously, and they are opposites: the second one is BACKPRESSURE, the
    // thing streaming exists to do. A chunk sitting in the downstream queue
    // waiting for a slow reader must not kill a healthy app.
    //
    // It also keeps the abort path honest. An abort can only be noticed by a
    // read that rejects, so arming while no read is outstanding could fire a
    // timer that nothing catches — aborting the upstream and leaving this
    // stream, and its permit, waiting for a client that is still perfectly
    // happy.
    async pull(controller) {
      arm();
      try {
        const { done, value } = await reader.read();
        disarm();
        if (done) {
          finish();
          controller.close();
          return;
        }
        controller.enqueue(value);
      } catch (err) {
        finish();
        controller.error(err);
      }
    },
    // The client hung up, or the office tore the response down. Cancel the
    // upstream reader AND abort the fetch: cancelling alone leaves the request
    // running at the app, which is the half-closed state this whole relay is
    // meant not to produce.
    cancel(reason) {
      opts.onStall();
      finish();
      reader.cancel(reason).catch(() => {});
    },
  });
  return { body, disarm };
}
