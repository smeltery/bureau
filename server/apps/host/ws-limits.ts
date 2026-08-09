// What one upstream connection to an app may cost, as named values with no env
// vars behind them.
//
// WHAT ONE CONNECTION CAN HOLD, derived rather than asserted — the relay's
// capacity math is built on this, so the terms are listed by what SURVIVES across
// event turns and what is transient within one:
//
//   surviving:  the write queue                       <= queueMaxBytes
//               the decoder's fragments + the one     <= maxMessageBytes + 14
//                 incomplete frame behind them          (together: the aggregate
//                                                        cap is enforced from a
//                                                        continuation's HEADER,
//                                                        so the pair cannot both
//                                                        approach the cap)
//   transient, and it stacks ON TOP of the surviving state rather than replacing
//   it, because a browser-to-app write can happen while the decoder is
//   mid-message:
//               inbound:  one copied TCP read         - whatever Bun hands us.
//                                                        NOT a constant we
//                                                        enforce: observed max
//                                                        524288 bytes on Bun
//                                                        1.3.11, pushing 32MB
//                                                        through a loopback
//                                                        socket. A runtime change
//                                                        could change it.
//                         + one decoded message        <= maxMessageBytes
//               outbound: one masked copy of the frame <= maxMessageBytes
//                         (the concatenated frame itself is the queued one, so it
//                          is already counted above)
//
// With the defaults below — 1MB message, 512KB queue — that is about 3.5MB per
// connection at peak, plus one Bun TCP read (observed max 512KB on 1.3.11). Every
// term above is either a named constant here or an observation with a number
// against it, and AppUpstream.heldBytes() exposes the two that are ours to
// enforce so a test can read them.

// The largest message relayed in either direction. Applies to a single frame and
// to a reassembled fragmented message alike. 1MB is far above what a WebSocket
// app protocol sends per message and far below anything that threatens the
// office; a message over it ends the connection with 1009, which is the code
// that means exactly this.
export const APP_WS_MAX_MESSAGE_BYTES = 1024 * 1024;

// The write queue's ceiling, in wire bytes. Reached when an app has stopped
// reading: the connection is then closed rather than held open at the office's
// expense. This is the number that makes the relay's memory statable.
export const APP_WS_QUEUE_MAX_BYTES = 512 * 1024;

// Held back inside the queue ceiling for control frames. Without it a full data
// queue would make a pong or a close frame unsendable, and the connection would
// die of silence with no way to say why. Sized for many control frames: each is
// at most 125 payload bytes plus a 14-byte header.
export const APP_WS_CONTROL_RESERVE_BYTES = 4 * 1024;

// How long the upgrade has to complete: the TCP connect, the request, and the
// whole response header block. Loopback, so this is a "the app is wedged"
// bound, not a latency allowance.
export const APP_WS_HANDSHAKE_TIMEOUT_MS = 10_000;

// The response header block's byte ceiling. An app that streams headers forever
// is refused rather than buffered.
export const APP_WS_HANDSHAKE_MAX_HEADER_BYTES = 16 * 1024;

// The same ceiling applied to the request WE write. The headers in it come from a
// browser's own upgrade request, so its size is not ours to assume: a caller that
// forwards something enormous is refused here rather than discovering it as a
// stall halfway through a write.
export const APP_WS_HANDSHAKE_MAX_REQUEST_BYTES = 16 * 1024;

// After a close frame goes out, how long the peer has to answer with its own
// before the socket is torn down. Short: the connection is already over, this
// only decides whether it ends politely.
export const APP_WS_CLOSE_HANDSHAKE_MS = 2_000;

export interface AppUpstreamLimits {
  maxMessageBytes: number;
  queueMaxBytes: number;
  controlReserveBytes: number;
  handshakeTimeoutMs: number;
  handshakeMaxHeaderBytes: number;
  handshakeMaxRequestBytes: number;
  closeHandshakeMs: number;
}

export const DEFAULT_UPSTREAM_LIMITS: AppUpstreamLimits = {
  maxMessageBytes: APP_WS_MAX_MESSAGE_BYTES,
  queueMaxBytes: APP_WS_QUEUE_MAX_BYTES,
  controlReserveBytes: APP_WS_CONTROL_RESERVE_BYTES,
  handshakeTimeoutMs: APP_WS_HANDSHAKE_TIMEOUT_MS,
  handshakeMaxHeaderBytes: APP_WS_HANDSHAKE_MAX_HEADER_BYTES,
  handshakeMaxRequestBytes: APP_WS_HANDSHAKE_MAX_REQUEST_BYTES,
  closeHandshakeMs: APP_WS_CLOSE_HANDSHAKE_MS,
};
