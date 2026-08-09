// What the app said before there was anywhere to put it.
//
// The relay dials the app BEFORE the browser is upgraded, so an app that speaks
// first can deliver a greeting — or a close — while no browser socket exists. Those
// bytes are owed to a leg that is about to exist: dropping them would lose the
// first message of every server that greets on connect, which for a greeting
// protocol is the only message that matters.
//
// One class for BOTH windows, because they are the same rule: the entry point's
// window (the dial has resolved, no relay object exists yet) and the relay's own
// (`server.upgrade` not called, or its `open` not fired).

import type { Buffered } from "./ws-relay-rules.ts";
import { sizeOf } from "./ws-relay-rules.ts";

export class PreOpenBuffer {
  private held: Buffered[] = [];
  private bytes = 0;
  private overflowed = false;

  constructor(private readonly maxBytes: number) {}

  // CHECK BEFORE RETAINING. Adding the message and then noticing would mean
  // holding one whole upstream message (up to 1MB) past the ceiling before
  // reacting, which is the ceiling being advisory rather than a bound.
  //
  // A message that does not fit is DROPPED and recorded as an overflow: there is
  // nowhere to put it, and pretending otherwise is what the ceiling exists to
  // prevent. What that costs the connection is the caller's decision.
  add(message: Buffered): "held" | "over_ceiling" {
    const size = sizeOf(message);
    if (this.overflowed || this.bytes + size > this.maxBytes) {
      this.overflowed = true;
      return "over_ceiling";
    }
    this.held.push(message);
    this.bytes += size;
    return "held";
  }

  // Has anything been dropped? A socket that has already lost data cannot be
  // opened honestly.
  overflow(): boolean {
    return this.overflowed;
  }

  size(): number {
    return this.bytes;
  }

  // Hand everything over IN ORDER and forget it: the buffer holds nothing once a
  // leg exists to receive it.
  take(): Buffered[] {
    const pending = this.held;
    this.held = [];
    this.bytes = 0;
    return pending;
  }

  clear(): void {
    this.held = [];
    this.bytes = 0;
  }
}
