export interface OutboundSocket {
  send(data: string): number;
  getBufferedAmount(): number;
  terminate(): void;
}

type Pending = { frame: string; bytes: number } | { frames: Iterator<string> };
const HIGH_WATER = 256 * 1024;
const PUMP_BUDGET = 512 * 1024;
const MAX_QUEUED = 8 * 1024 * 1024;
const MAX_ITEMS = 8192;

/** Ordered, bounded live traffic behind a lazily serialized history replay. */
export class BrowserOutbox {
  private pending: Pending[] = [];
  private queuedBytes = 0;
  private scheduled = false;
  private blocked = false;
  private disposed = false;

  constructor(
    private readonly socket: OutboundSocket,
    private readonly schedule: (run: () => void) => void = (run) => {
      setTimeout(run, 0);
    },
  ) {}

  get backlogged(): boolean {
    return this.pending.length > 0 || this.blocked || this.socket.getBufferedAmount() > 0;
  }

  send(frame: string): number {
    if (this.disposed) return 0;
    const bytes = Buffer.byteLength(frame);
    if (!this.pending.length && !this.blocked && this.socket.getBufferedAmount() < HIGH_WATER) {
      return this.write(frame);
    }
    if (this.queuedBytes + bytes > MAX_QUEUED || this.pending.length >= MAX_ITEMS) {
      this.fail();
      return 0;
    }
    this.pending.push({ frame, bytes });
    this.queuedBytes += bytes;
    this.later();
    return bytes;
  }

  replay(frames: Iterator<string>): void {
    if (this.disposed || this.pending.length >= MAX_ITEMS) {
      this.fail();
      frames.return?.();
      return;
    }
    this.pending.push({ frames });
    this.later();
  }

  drain(): void {
    this.blocked = false;
    // Bun must leave its drain callback before another send is attempted.
    this.later();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const item of this.pending) {
      if ("frames" in item) {
        try {
          item.frames.return?.();
        } catch {
          /* Cleanup must not prevent socket shutdown. */
        }
      }
    }
    this.pending = [];
    this.queuedBytes = 0;
  }

  fail(): void {
    if (this.disposed) return;
    this.dispose();
    try {
      this.socket.terminate();
    } catch {
      /* The transport may already be closed. */
    }
  }

  private write(frame: string): number {
    try {
      const result = this.socket.send(frame);
      if (result === 0) this.fail();
      else if (result === -1) this.blocked = true;
      return result;
    } catch {
      this.fail();
      return 0;
    }
  }

  private later(): void {
    if (this.disposed || this.scheduled || this.blocked) return;
    this.scheduled = true;
    this.schedule(() => {
      this.scheduled = false;
      this.pump();
    });
  }

  private pump(): void {
    if (this.disposed || this.blocked) return;
    let sentBytes = 0;
    try {
      while (this.pending.length && this.socket.getBufferedAmount() < HIGH_WATER) {
        const item = this.pending[0]!;
        let frame: string;
        if ("frames" in item) {
          const next = item.frames.next();
          if (next.done) {
            this.pending.shift();
            continue;
          }
          frame = next.value;
        } else {
          frame = item.frame;
          this.pending.shift();
          this.queuedBytes -= item.bytes;
        }
        const result = this.write(frame);
        // -1 means accepted into Bun's buffer; never replay that frame twice.
        if (result === 0 || result === -1) return;
        sentBytes += Buffer.byteLength(frame);
        if (sentBytes >= PUMP_BUDGET) {
          this.later();
          return;
        }
      }
    } catch {
      this.fail();
    }
  }
}
