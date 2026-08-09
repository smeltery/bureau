// One relayed WebSocket, from the dial to whichever end dies first.
//
// THE TWO LEGS ARE NOT SYMMETRIC, and most of what looks like duplication below
// is that asymmetry:
//
//   browser leg   Bun's own server WebSocket. Bun owns the queue; `send` returns
//                 a byte count, -1 when it enqueued, or 0 when it DROPPED the
//                 message past its own ~16MB ceiling (measured). We never see
//                 the frames, so the only lever is refusing to hand it more.
//   app leg       host-ws-upstream.ts. We own the queue, the masking, the close
//                 handshake and the ping answers, because Bun's client buffers
//                 browser-to-app writes without bound (measured).
//
// WHAT THIS OWNS THAT NEITHER LEG DOES: one lifecycle with one exit, the two
// caps, and the close mapping.

import type { ServerWebSocket } from "bun";
// Type-only, and therefore not a runtime cycle: the socket's data shape lives with
// the office-facing callbacks that read it, in host-ws-relay.ts.
import type { AppRelayWsData } from "./ws-relay.ts";
import type { SocketPermit } from "./ws-relay-permits.ts";
import { PreOpenBuffer } from "./ws-relay-preopen.ts";
import { relaySocketStillAllowed, sendWithinBrowserCeiling, type RelaySession } from "./ws-relay-session.ts";
import { CLOSE_BACKPRESSURE, CLOSE_GOING_AWAY, CLOSE_REVOKED, CLOSE_TOO_LARGE, endingFor, fault, sizeOf, type Buffered, type RelayEnding } from "./ws-relay-rules.ts";
import type { AppUpstream, UpstreamCloseEvent } from "./ws-upstream.ts";

// THE STATE MACHINE IS THE POINT of this class. A relay that dials before it
// upgrades has a window — real, and measured in event-loop turns rather than
// nanoseconds — in which the app is connected and talking while the browser
// socket does not exist yet. Every subtle failure here lives in that window, so
// the states are named and each one says exactly what an upstream close means:
//
//   preOpen       dial resolved, `server.upgrade` not yet called. Messages are
//                 buffered and an upstream close is RECORDED, not fatal: the app
//                 already spoke WebSocket, so an app that greets and hangs up —
//                 or closes with 4001 "not authorized" — reaches the browser as
//                 a socket that opens and closes with the app's own code, which
//                 is what its bare port does. Only a dial that never succeeded
//                 is a 502.
//   awaitingOpen  the 101 went out, Bun's `open` has not fired. Same rule, same
//                 reason: the bytes the app already sent are owed to a leg that
//                 is about to exist, and finishing would drop them.
//   open          normal operation.
//   closed        idempotent.
//
// HOW OFTEN `awaitingOpen` IS ACTUALLY REACHED, measured rather than assumed:
// on Bun 1.3.11 `server.upgrade()` calls the `open` handler SYNCHRONOUSLY,
// before it returns — the observed event order for a client that completes the
// handshake and immediately drops TCP is `open -> upgrade() returns -> close
// (1006)`. So attachBrowser has usually run before `server.upgrade()` has even
// returned, and that state is the defensive path rather than the common one. It
// stays because the ordering is the runtime's choice, not a guarantee, and a
// future Bun that defers `open` by a turn would otherwise silently start
// dropping an app's first messages. The same measurement is what rules out a
// stranded permit: `open` fires even for a socket that is already gone, so the
// finalizer is always reached.
export class AppWsRelay {
  private state: "preOpen" | "awaitingOpen" | "open" | "closed" = "preOpen";
  private ws: ServerWebSocket<AppRelayWsData> | null = null;
  private readonly preOpen: PreOpenBuffer;
  private recorded: UpstreamCloseEvent | null = null;
  private recheckTimer: ReturnType<typeof setInterval> | null = null;
  // Shutdown has been INITIATED. Not the same thing as over: a close is a
  // handshake, and both legs can still be physically alive after this is set.
  private shuttingDown = false;
  // Which transports are still live. The permit is held until BOTH are gone,
  // because the cap counts SOCKETS, not relay objects that have been asked to
  // close. Releasing when shutdown starts would let a new relay take the slot
  // while the old sockets are still up — the upstream client gives the app leg up
  // to APP_WS_CLOSE_HANDSHAKE_MS to answer, and a browser can dawdle too — so a
  // repeated fault could hold more than 64 real sockets under a cap of 64.
  //
  // The failure direction is deliberate: a leg whose runtime never reports
  // closure holds its permit forever, so the cap can only ever be too STRICT.
  // Failing the other way would make it a cap in name only.
  private upstreamLive = true;
  private browserLive = false;

  constructor(
    private readonly upstream: AppUpstream,
    private readonly permit: SocketPermit,
    private readonly session: RelaySession,
    private readonly bufferMaxBytes: number,
    private readonly recheckMs: number,
  ) {
    this.preOpen = new PreOpenBuffer(bufferMaxBytes);
  }

  // --- upstream callbacks ----------------------------------------------------

  onUpstreamMessage(message: Buffered): void {
    if (this.shuttingDown) return;
    if (this.state === "open") {
      this.sendToBrowser(message);
      return;
    }
    // Over the ceiling is fatal here rather than merely recorded: this connection
    // has a browser leg coming, and one that has already lost data cannot be
    // opened honestly.
    if (this.preOpen.add(message) === "over_ceiling") {
      this.finish(fault(CLOSE_BACKPRESSURE, "app is too fast"), `app sent more than ${this.bufferMaxBytes} bytes before the socket opened`);
    }
  }

  onUpstreamClose(event: UpstreamCloseEvent): void {
    // The app leg is gone, whatever else is true. Recorded FIRST so every path
    // below — including the ones that return early — leaves the accounting
    // right. The upstream client promises this fires exactly once.
    this.upstreamLive = false;
    if (this.shuttingDown) {
      this.releaseIfBothLegsEnded();
      return;
    }
    if (this.state !== "open") {
      // Recorded, NOT finalized. There is no browser leg yet — either the
      // upgrade has not been called or its `open` has not fired — and finishing
      // here would drop both the app's last messages and its close CODE.
      //
      // An ordinary app pattern is what this is for: an app that greets and hangs
      // up, or that accepts the socket and closes it with 4001 "not authorized",
      // has already spoken WebSocket. Answering 502 "this app did not respond"
      // would be false, and would throw away the code the app closed with — the
      // one thing it was trying to say. Reaching the browser as a socket that
      // opens and immediately closes with the app's own code is also exactly what
      // hitting the app's port directly does. A dial that never succeeded is
      // still a 502; this is not that.
      this.recorded = event;
      return;
    }
    // The app is already closing — it is the one that closed — so there is
    // nothing to send back up that leg.
    this.finish({ browser: endingFor(event), upstream: null }, event.detail ?? "the app closed the socket");
  }

  // --- browser callbacks (from the office's shared websocket handlers) -------

  attachBrowser(ws: ServerWebSocket<AppRelayWsData>): void {
    if (this.shuttingDown) {
      // The relay died between the 101 and this callback. Nothing to relay to
      // and nothing to say — the close the finalizer wanted cannot have reached
      // a socket that did not exist, so it is sent here.
      try {
        ws.close(CLOSE_GOING_AWAY, "app closed");
      } catch {
        // already gone
      }
      return;
    }
    this.ws = ws;
    this.state = "open";
    // Idempotent restatement: beginUpgrade has already set this, and this
    // callback can run INSIDE server.upgrade(). Set here too so the invariant
    // holds even if a caller ever attaches without going through the entry
    // point.
    this.browserLive = true;
    // Flush IN ORDER first, then the ending. A close that overtook the app's
    // last message would lose it silently, and "the app greeted me and hung up"
    // is a real protocol.
    for (const message of this.preOpen.take()) {
      if (this.shuttingDown) return;
      this.sendToBrowser(message);
    }
    if (this.recorded !== null) {
      const event = this.recorded;
      this.recorded = null;
      this.finish({ browser: endingFor(event), upstream: null }, event.detail ?? "the app closed the socket");
      return;
    }
    this.armRecheck();
  }

  browserMessage(data: string | Buffer): void {
    if (this.shuttingDown || this.state !== "open") return;
    const outcome = typeof data === "string" ? this.upstream.sendText(data) : this.upstream.sendBinary(Buffer.from(data));
    switch (outcome) {
      case "sent":
        return;
      case "queue_full":
        // The app has stopped reading. The upstream client's contract is that the
        // caller ends the connection rather than letting the queue grow.
        this.finish(fault(CLOSE_BACKPRESSURE, "app stopped reading"), "upstream write queue is full");
        return;
      case "too_large":
        this.finish(fault(CLOSE_TOO_LARGE, "message too large"), "browser sent a message over the relay's message cap");
        return;
      case "closing":
        // The app leg is already going; its own close callback finishes this.
        return;
    }
  }

  browserClosed(code: number, reason: string): void {
    // The browser leg is gone: nothing may be sent to it from here on, and the
    // permit accounting has to know before anything else runs.
    this.browserLive = false;
    this.ws = null;
    if (this.shuttingDown) {
      this.releaseIfBothLegsEnded();
      return;
    }
    if (code === 1006) {
      // The tab vanished, the network dropped, the process died. No close frame
      // was exchanged, so none is invented: the upstream client's terminate()
      // ends the TCP connection without one and the app sees 1006 — the same
      // event, told the same way it reached us.
      this.upstream.terminate("browser socket dropped");
    } else if (code === 1005) {
      // Closed cleanly with no status. Relayed as no status.
      this.upstream.sendClose(null, "", "browser closed without a status");
    } else {
      this.upstream.sendClose(code, reason, "browser closed the socket");
    }
    // Both legs are accounted for already: the browser is gone, and the line
    // above told the app in its own vocabulary.
    this.finish({ browser: null, upstream: null }, `browser closed (${code})`);
  }

  // --- internals -------------------------------------------------------------

  // Called IMMEDIATELY BEFORE the runtime is asked to take the socket, never
  // after it answers.
  //
  // The ordering is the whole point, and it comes straight out of the measured
  // Bun behavior: `server.upgrade()` runs the `open` callback SYNCHRONOUSLY,
  // inside the call. So by the time upgrade() returns, attachBrowser may already
  // have run, flushed a recorded close, and finished the relay. Marking the leg
  // live afterwards would mean that finish saw `browserLive === false`, released
  // the permit while the browser's close handshake was still physically live,
  // and only then had the flag set — a leg alive with no permit behind it, which
  // is the fail-open cap bug again on the greet-and-close path.
  //
  // From this call there is a browser leg as far as the accounting is concerned,
  // even if the runtime turns out to refuse the upgrade — see upgradeRejected,
  // which is the only thing allowed to take it back.
  beginUpgrade(): void {
    this.browserLive = true;
    if (this.state === "preOpen") this.state = "awaitingOpen";
  }

  // The runtime did NOT take the socket (returned false, or threw). There is no
  // browser leg and there never will be, so the attempt is taken back — and
  // nothing else may resurrect it, because a close callback that has already
  // cleared the flag must stay cleared.
  upgradeRejected(): void {
    this.browserLive = false;
  }

  isLive(): boolean {
    return !this.shuttingDown && this.state === "preOpen";
  }

  // The permit goes back when the LAST live transport has reported that it is
  // gone — not when the office decided they should go. Idempotent by the
  // permit's own flag as well as this one, so a stray extra callback cannot
  // double-release and let the cap drift open.
  private releaseIfBothLegsEnded(): void {
    if (!this.shuttingDown) return;
    if (this.upstreamLive || this.browserLive) return;
    this.permit.release();
  }

  private sendToBrowser(message: Buffered): void {
    const ws = this.ws;
    if (ws === null) return;
    // Both refusals are the same fault with a different diagnosis, and both are
    // fatal: a ceiling reached means the browser stopped reading, and a dropped
    // message means the stream now has a hole in it.
    const outcome = sendWithinBrowserCeiling(ws, message, this.bufferMaxBytes);
    if (outcome === "over_ceiling") {
      this.finish(fault(CLOSE_BACKPRESSURE, "browser stopped reading"), "browser leg is over its buffer ceiling");
    } else if (outcome === "dropped") {
      this.finish(fault(CLOSE_BACKPRESSURE, "browser stopped reading"), "the runtime dropped a message on the browser leg");
    }
  }

  private armRecheck(): void {
    if (this.recheckTimer !== null) return;
    const timer = setInterval(() => this.recheck(), this.recheckMs);
    // Nothing about a relayed socket should keep the office process alive.
    (timer as unknown as { unref?: () => void }).unref?.();
    this.recheckTimer = timer;
  }

  // Is this socket still allowed to exist? The two authorities, and the
  // fail-closed rule, are in host-ws-relay-session.ts; what a "no" costs is here.
  private recheck(): void {
    if (this.shuttingDown) return;
    const allowed = relaySocketStillAllowed(this.session);
    if (allowed.ok) return;
    this.finish(fault(CLOSE_REVOKED, "session ended"), allowed.detail);
  }

  // THE one exit. Releases the permit, stops the timer, drops the buffer, and
  // ends both legs — once, from any state, whichever side got here first. A
  // relay whose permit can be released twice is a relay whose caps drift, so
  // "exactly once" is a property of this method rather than a rule each caller
  // remembers.
  //
  // `ending` carries BOTH legs, so a fault the relay diagnosed reaches the app
  // and the browser as the same code and the same reason. Either side may be
  // null: already gone, never upgraded, or already told.
  finish(ending: RelayEnding, detail: string): void {
    if (this.shuttingDown) return;
    this.shuttingDown = true;
    this.state = "closed";
    if (this.recheckTimer !== null) clearInterval(this.recheckTimer);
    this.recheckTimer = null;
    this.preOpen.clear();
    this.recorded = null;
    const ws = this.ws;
    this.ws = null;
    if (ws !== null && ending.browser !== null) {
      try {
        if (ending.browser.kind === "terminate") ws.terminate();
        else ws.close(ending.browser.code, ending.browser.reason);
      } catch {
        // The socket went while we were deciding how to end it.
      }
    }
    if (ending.upstream !== null && this.upstream.isOpen()) {
      this.upstream.sendClose(ending.upstream.code, ending.upstream.reason, detail);
    }
    // Both closes are now IN FLIGHT. Neither leg is necessarily gone: the app
    // has up to the upstream client's close-handshake budget to answer, and the
    // browser's own close callback arrives on the runtime's schedule. The permit
    // goes back in those callbacks, not here — see releaseIfBothLegsEnded.
    //
    // Deliberately NOT consulting upstream.isOpen() as a shortcut: the upstream
    // client reports `closing` as not-open the moment a close frame is QUEUED, so
    // that test would mark the leg dead while its socket is still up and hand the
    // slot away — the exact bug this method exists to fix. Only onClose, which
    // the upstream client promises exactly once, ends the app leg.
    this.releaseIfBothLegsEnded();
  }
}
