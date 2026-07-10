import type { NormalizedEvent } from "../types.ts";

export class CodexSessionEventBuffer {
  private buffer: NormalizedEvent[] = [];
  private resolveWake: (() => void) | null = null;
  private ended = false;

  async *stream(): AsyncGenerator<NormalizedEvent, void> {
    while (true) {
      while (this.buffer.length > 0) {
        yield this.buffer.shift()!;
      }
      if (this.ended) return;
      await new Promise<void>((resolve) => {
        this.resolveWake = resolve;
      });
    }
  }

  enqueue(ev: NormalizedEvent): void {
    this.buffer.push(ev);
    this.wake();
  }

  markEnded(): void {
    this.ended = true;
    this.wake();
  }

  private wake(): void {
    if (this.resolveWake) {
      const r = this.resolveWake;
      this.resolveWake = null;
      r();
    }
  }
}
