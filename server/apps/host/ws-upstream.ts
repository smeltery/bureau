// The relay's WebSocket connection to an app on loopback.
//
// One connection to one app, over a raw TCP socket, using the codec in
// host-ws-frames.ts and host-ws-decoder.ts. Bun's own WebSocket client would be
// less code; it is not used for one measured reason, recorded here because it is
// the whole justification for this file: its write queue is unbounded and
// invisible. Sending 120MB to an app that had stopped reading left
// `bufferedAmount` at 0 while the process grew to 211MB RSS (Bun 1.3.11). A raw
// socket instead returns a short count or zero from `write()`, buffers nothing
// itself, and fires `drain` when the peer resumes — so the queue is OURS, with a
// number on it, and an app that stops reading gets its connection closed instead
// of quietly costing the office memory it shares with every agent.
//
// WHAT THIS OWNS
//   - the write queue (host-ws-write-queue.ts), accounted in WIRE bytes with a
//     reserve so a pong or a close can still leave when the data queue is full;
//   - ping (answered here, payload echoed) and pong (consumed here);
//   - the close handshake, bounded by a timer, converging on ONE finalizer. What
//     each way of ending MEANS is host-ws-close-semantics.ts.
//
// The HTTP upgrade that produces one of these — bounded in both bytes and time,
// validated strictly — lives in host-ws-dial.ts.
//
// The numbers all of that is written in terms of — and the derivation of what one
// connection can hold at peak — live in host-ws-limits.ts.
//
// WHAT IT DELIBERATELY DOES NOT OWN: any policy. It does not know what an app
// is, cannot look one up, and holds no credential. host-ws-relay.ts decides who
// may connect and what to do when this connection ends.

import type { Socket } from "bun";
import { FrameDecoder, type DecodedMessage } from "./ws-decoder.ts";
import { closeEventForTransportDeath, type AppUpstreamHandlers, type SendOutcome, type UpstreamCloseEvent } from "./ws-close-semantics.ts";
import type { AppUpstreamLimits } from "./ws-limits.ts";
import { UpstreamWriteQueue } from "./ws-write-queue.ts";
import { MAX_CONTROL_PAYLOAD_BYTES, encodeBinaryFrame, encodeCloseFrame, encodePongFrame, encodeTextFrame, isTransmittableCloseCode, truncateCloseReason } from "./ws-frames.ts";

// Re-exported so a caller talking to a connection has one import for the whole
// contract: the handlers it supplies, what a send can answer, and what a close
// reports.
export type { AppUpstreamHandlers, SendOutcome, UpstreamCloseEvent } from "./ws-close-semantics.ts";

const EMPTY = Buffer.alloc(0);

// One live connection. Every method is safe to call at any point in the
// lifecycle — after a close, sends report "closing" rather than throwing,
// because a relay's two legs die in whichever order the network chooses.
export class AppUpstream {
  private readonly socket: Socket<undefined>;
  private readonly limits: AppUpstreamLimits;
  private readonly handlers: AppUpstreamHandlers;
  private readonly decoder: FrameDecoder;
  // Frames waiting for the socket, and the only place their bytes are counted.
  private readonly queue: UpstreamWriteQueue;
  private state: "open" | "closing" | "closed" = "open";
  private closeTimer: ReturnType<typeof setTimeout> | null = null;
  private finished = false;
  // Set when this end initiated or answered a close, so the finalizer can tell
  // an app's goodbye from our own.
  private pendingClose: UpstreamCloseEvent | null = null;
  // Bytes that shared the handshake's last read, held until begin().
  private leftover: Buffer = EMPTY;
  // Set when a close frame is queued that MUST reach the peer before the socket
  // goes: the echo of the app's own close. The flush finishes the connection the
  // moment the queue empties.
  private finalizeWhenFlushed: UpstreamCloseEvent | null = null;

  readonly protocol: string | null;

  constructor(init: { socket: Socket<undefined>; limits: AppUpstreamLimits; handlers: AppUpstreamHandlers; protocol: string | null; leftover: Buffer }) {
    this.socket = init.socket;
    this.limits = init.limits;
    this.handlers = init.handlers;
    this.protocol = init.protocol;
    this.decoder = new FrameDecoder({ maxMessageBytes: init.limits.maxMessageBytes });
    this.queue = new UpstreamWriteQueue(init.socket, init.limits, {
      onWriteFailed: (err) => this.terminate(`socket write failed: ${String(err).slice(0, 120)}`),
      onDrained: () => this.onQueueDrained(),
    });
    this.leftover = init.leftover;
  }

  // Feed the bytes that arrived in the same TCP read as the end of the handshake
  // headers.
  //
  // DELIBERATELY NOT DONE IN THE CONSTRUCTOR. Those bytes can be a close frame
  // or a protocol violation, either of which ends the connection — and ending it
  // runs the socket's close handler SYNCHRONOUSLY, before the constructor has
  // even returned. The dial would then still be holding a null connection
  // reference and would report its generic "closed during the upgrade" instead of
  // the outcome that actually happened. So the caller publishes the connection
  // and settles the dial FIRST, then calls this.
  begin(): void {
    const bytes = this.leftover;
    this.leftover = EMPTY;
    if (bytes.length > 0) this.receive(bytes);
  }

  queuedBytes(): number {
    return this.queue.bytes();
  }

  // Bytes this connection is holding: the write queue plus whatever the decoder
  // has not yet turned into a message. The relay's memory bound is written in
  // terms of this, and the test that asserts the bound reads it.
  heldBytes(): number {
    return this.queue.bytes() + this.decoder.pendingBytes();
  }

  isOpen(): boolean {
    return this.state === "open";
  }

  sendText(text: string): SendOutcome {
    if (this.state !== "open") return "closing";
    // Byte length, not string length: the cap is a wire cap.
    if (Buffer.byteLength(text, "utf8") > this.limits.maxMessageBytes) {
      return "too_large";
    }
    return this.enqueue(encodeTextFrame(text), false);
  }

  sendBinary(data: Buffer): SendOutcome {
    if (this.state !== "open") return "closing";
    if (data.length > this.limits.maxMessageBytes) return "too_large";
    return this.enqueue(encodeBinaryFrame(data), false);
  }

  // Begin the close handshake. `code === null` sends a close with no status,
  // which is the honest wire form when the browser gave us none.
  sendClose(code: number | null, reason = "", detail: string | null = null): void {
    if (!this.isOpen()) return;
    this.state = "closing";
    this.pendingClose = { code, reason: truncateCloseReason(reason), abnormal: false, detail };
    const frame =
      code !== null && isTransmittableCloseCode(code)
        ? encodeCloseFrame(code, reason)
        : // A code that cannot go on the wire is sent as "no status" rather than
          // as something else: substituting a different number would put words
          // in the browser's mouth.
          encodeCloseFrame(null);
    this.enqueue(frame, true);
    if (this.finished) return;
    // The peer gets a moment to answer, then the socket goes regardless. A
    // half-closed connection waiting forever is the state this whole module is
    // meant not to produce. The original reason is carried through the timeout
    // rather than replaced by it, because that is what a log needs.
    this.armCloseTimer({ code, reason: truncateCloseReason(reason), abnormal: false, detail }, detail ?? "closing");
  }

  // End the TCP connection with NO close frame.
  //
  // This is not rudeness, it is vocabulary: a WebSocket close code of 1006
  // means "the connection dropped without a close frame", and it is the only
  // truthful thing to send an app when the browser at the other end vanished
  // the same way. Measured on Bun 1.3.11: this is also what Bun's own client
  // does internally when handed an untransmittable code, which is what made the
  // behavior discoverable in the first place.
  terminate(detail = "terminated"): void {
    if (this.finished) return;
    this.finish({ code: null, reason: "", abnormal: true, detail });
  }

  // --- internals -------------------------------------------------------------

  private enqueue(frame: Buffer, isControl: boolean): SendOutcome {
    if (this.queue.push(frame, isControl) === "queue_full") {
      if (!isControl) return "queue_full";
      // A control frame that will not fit even inside the reserve means the
      // ceiling is already breached; terminating is the only option that keeps
      // the bound true. The reserve is sized so this cannot happen in practice.
      this.terminate("control frame over the queue ceiling");
      return "queue_full";
    }
    return "sent";
  }

  // Write as much as the socket will take; the queue keeps whatever it would not.
  private flush(): void {
    if (this.state === "closed") return;
    this.queue.flush();
  }

  // The queue just emptied. If a close was waiting for its own bytes to leave,
  // this is the moment it is safe to end the socket.
  private onQueueDrained(): void {
    const waiting = this.finalizeWhenFlushed;
    if (waiting !== null) {
      this.finalizeWhenFlushed = null;
      this.finish(waiting);
    }
  }

  // Called by the socket handlers set up in dialAppUpstream.
  onDrain(): void {
    this.flush();
  }

  receive(chunk: Buffer): void {
    // A CLOSING connection keeps reading, and that is not a detail: after this
    // end sends a close, the peer's own close frame is what completes the
    // handshake. Stopping at `closing` meant a well-behaved app that answers and
    // leaves the socket open was ignored until the timer, and then reported as an
    // abnormal close — a real app's polite goodbye recorded as a failure. (A Bun
    // app hides this by dropping TCP too.) What does NOT happen while closing is
    // delivery: `handle` gates data and ping on the open state, so only the close
    // is acted on.
    if (this.finished) return;
    // Each message is handled as it is decoded and then dropped, so one decoded
    // message is in hand at a time rather than a whole read's worth. `stop` ends
    // the parse once the connection is finished — there is nothing left to tell
    // anyone.
    const result = this.decoder.push(chunk, (message) => {
      this.handle(message);
      return this.finished ? "stop" : "continue";
    });
    if (!result.ok) {
      // Tell the peer which rule it broke — once — and let the finalizer run on
      // its answer or on the close timer. A no-op when a close is already in
      // flight (sendClose only acts on an open connection), which is right: the
      // connection is ending anyway and the first diagnosis is the useful one.
      // Nothing more of this stream is parsed either way — the decoder is spent
      // after a failure.
      this.sendClose(result.failure.code, "", `protocol error: ${result.failure.detail}`);
    }
  }

  private handle(message: DecodedMessage): void {
    switch (message.kind) {
      case "text":
        if (this.state === "open") {
          this.handlers.onMessage({ kind: "text", text: message.text });
        }
        return;
      case "binary":
        if (this.state === "open") {
          this.handlers.onMessage({ kind: "binary", data: message.data });
        }
        return;
      case "ping":
        // Answered here, payload echoed, because a pong belongs to the leg the
        // ping came from. Bun's server answers the browser's pings on the other
        // leg the same way (measured), so keepalive stays per-leg and no ping
        // ever crosses the relay.
        if (this.state === "open" && message.payload.length <= MAX_CONTROL_PAYLOAD_BYTES) {
          this.enqueue(encodePongFrame(message.payload), true);
        }
        return;
      case "pong":
        // Consumed. Nothing on this side ever sends a ping, so a pong is either
        // unsolicited or an answer to something the app imagined.
        return;
      case "close":
        this.onPeerClose(message.code, message.reason);
        return;
    }
  }

  private onPeerClose(code: number | null, reason: string): void {
    const event: UpstreamCloseEvent = { code, reason, abnormal: false, detail: null };
    if (this.state !== "open") {
      // The peer is answering OUR close, which completes the handshake. Report
      // what THIS end decided — pendingClose carries the reason, e.g. which
      // protocol rule the app broke — rather than the echo of it, and not
      // abnormal, because the handshake did finish.
      this.finish(this.pendingClose ?? event);
      return;
    }
    // The RFC's echo: answer with the same code so the peer knows its close was
    // understood. It must actually LEAVE first — finishing here would clear the
    // queue and end the socket, silently dropping the echo in exactly the case
    // the queue exists for (a peer that is not draining). So the finalizer waits
    // on the flush, bounded by the close timer.
    this.state = "closing";
    this.pendingClose = event;
    this.finalizeWhenFlushed = event;
    this.enqueue(code === null ? encodeCloseFrame(null) : encodeCloseFrame(code, reason), true);
    // The write may have gone out whole, in which case the flush below already
    // finished the connection and this timer is never armed.
    if (this.finished) return;
    this.armCloseTimer(event, "echoing the app's close");
  }

  // The close handshake's bound, in one place: whatever started the close, the
  // socket goes after this whether the peer answers or not. `because` is kept so
  // a timeout does not erase the reason for closing.
  private armCloseTimer(event: UpstreamCloseEvent, because: string): void {
    if (this.closeTimer !== null) return;
    this.closeTimer = setTimeout(() => {
      this.finish({ ...event, abnormal: true, detail: `${because}; close handshake timed out` });
    }, this.limits.closeHandshakeMs);
  }

  onSocketClose(): void {
    this.transportDied("socket closed");
  }

  onSocketError(err: unknown): void {
    this.transportDied(`socket error: ${String(err).slice(0, 120)}`);
  }

  private transportDied(cause: string): void {
    this.finish(closeEventForTransportDeath(this.finalizeWhenFlushed, this.pendingClose, cause));
  }

  // THE one exit. Every path — a close frame either way, a timeout, a socket
  // error, a protocol error, a terminate — ends here, exactly once: the timer is
  // cleared, the queue dropped, the socket ended, and the handler called a
  // single time. A relay whose accounting can be released twice is a relay whose
  // permits drift, so "exactly once" is enforced here rather than remembered at
  // each call site.
  private finish(event: UpstreamCloseEvent): void {
    if (this.finished) return;
    this.finished = true;
    this.state = "closed";
    if (this.closeTimer !== null) clearTimeout(this.closeTimer);
    this.closeTimer = null;
    this.finalizeWhenFlushed = null;
    this.queue.clear();
    try {
      this.socket.end();
    } catch {
      // Already gone; nothing to do.
    }
    this.handlers.onClose(event);
  }
}
