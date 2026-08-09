// The write queue for one upstream connection: the number that makes the relay's
// memory statable.
//
// This is the whole reason the app leg is a raw TCP socket rather than Bun's
// WebSocket client. `write()` returns a short count or zero when the peer is not
// draining, the socket buffers nothing of its own, and `drain` says when the peer
// resumed — so the queue is OURS, accounted in WIRE bytes, and an app that stops
// reading gets its connection closed instead of quietly costing the office memory
// it shares with every agent.
//
// It owns its bytes completely: nothing outside can add to them except through
// `push`, and the only reader of the total is `bytes()`. The connection that owns
// one decides what a refusal MEANS — a data frame refused is backpressure, a
// control frame refused means the ceiling is already breached — because that is a
// lifecycle decision and this is not.

import type { Socket } from "bun";

export interface WriteQueueLimits {
  queueMaxBytes: number;
  // Held back inside the queue ceiling for control frames. Without it a full data
  // queue would make a pong or a close frame unsendable, and the connection would
  // die of silence with no way to say why.
  controlReserveBytes: number;
}

export interface WriteQueueHooks {
  // The socket refused a write outright. The connection ends; this queue does not
  // decide how.
  onWriteFailed(err: unknown): void;
  // The queue just went empty. A close waiting for its own bytes to leave is
  // finished from here, which is why it is a hook rather than a poll.
  onDrained(): void;
}

export type QueueOutcome = "sent" | "queue_full";

export class UpstreamWriteQueue {
  // Frames waiting for the socket. The head may be partially written.
  private frames: Buffer[] = [];
  private bytesValue = 0;

  constructor(
    private readonly socket: Socket<undefined>,
    private readonly limits: WriteQueueLimits,
    private readonly hooks: WriteQueueHooks,
  ) {}

  bytes(): number {
    return this.bytesValue;
  }

  // Queue a frame and write what the socket will take. A data frame may only use
  // the queue below the control reserve; a control frame may use all of it.
  push(frame: Buffer, isControl: boolean): QueueOutcome {
    const ceiling = isControl ? this.limits.queueMaxBytes : this.limits.queueMaxBytes - this.limits.controlReserveBytes;
    if (this.bytesValue + frame.length > ceiling) return "queue_full";
    this.frames.push(frame);
    this.bytesValue += frame.length;
    this.flush();
    return "sent";
  }

  // Write as much as the socket will take. A short write leaves the remainder at
  // the head of the queue; `drain` calls this again. Re-entrant by construction:
  // it only ever reads and rewrites the queue, so a drain that arrives during a
  // write finds consistent state.
  flush(): void {
    while (this.frames.length > 0) {
      const head = this.frames[0];
      let written: number;
      try {
        written = this.socket.write(head);
      } catch (err) {
        this.hooks.onWriteFailed(err);
        return;
      }
      if (written >= head.length) {
        this.frames.shift();
        this.bytesValue -= head.length;
        continue;
      }
      // Partial write: the socket's buffer is full. Keep the tail and wait.
      if (written > 0) {
        this.frames[0] = head.subarray(written);
        this.bytesValue -= written;
      }
      return;
    }
    this.hooks.onDrained();
  }

  // Drop everything still waiting. Called from the connection's one exit: after
  // it, nothing of this queue is owed to anyone.
  clear(): void {
    this.frames = [];
    this.bytesValue = 0;
  }
}
