import { describe, expect, test } from "bun:test";
import { BrowserOutbox } from "./queue.ts";

function harness() {
  const ticks: Array<() => void> = [];
  const sent: string[] = [];
  let buffered = 0,
    result = 1,
    terminated = 0;
  const queue = new BrowserOutbox(
    {
      send: (frame) => {
        sent.push(frame);
        return result;
      },
      getBufferedAmount: () => buffered,
      terminate: () => {
        terminated++;
      },
    },
    (run) => ticks.push(run),
  );
  return {
    queue,
    sent,
    ticks,
    tick: () => ticks.shift()?.(),
    setBuffered: (value: number) => {
      buffered = value;
    },
    setResult: (value: number) => {
      result = value;
    },
    terminated: () => terminated,
  };
}

describe("browser outbound queue", () => {
  test("replays lazily and preserves history, fence, then live order", () => {
    const h = harness();
    let produced = 0;
    h.setBuffered(256 * 1024);
    h.queue.replay(
      (function* () {
        produced++;
        yield "history";
        yield "fence";
      })(),
    );
    h.queue.send("live");
    h.tick();
    expect(produced).toBe(0);
    expect(h.sent).toEqual([]);
    h.setBuffered(0);
    h.queue.drain();
    expect(h.sent).toEqual([]);
    h.tick();
    expect(h.sent).toEqual(["history", "fence", "live"]);
    expect(h.queue.backlogged).toBe(false);
  });

  test("never repeats a frame accepted with backpressure", () => {
    const h = harness();
    h.setResult(-1);
    h.queue.replay(["first", "second", "fence"][Symbol.iterator]());
    h.tick();
    h.queue.send("live");
    expect(h.sent).toEqual(["first"]);
    h.setResult(1);
    h.queue.drain();
    expect(h.sent).toEqual(["first"]);
    h.tick();
    expect(h.sent).toEqual(["first", "second", "fence", "live"]);
  });

  test("yields after a bounded batch even on a fast socket", () => {
    const h = harness();
    const large = "x".repeat(256 * 1024);
    h.queue.replay([large, large, "last"][Symbol.iterator]());
    h.tick();
    expect(h.sent.length).toBe(2);
    h.tick();
    expect(h.sent.at(-1)).toBe("last");
  });

  test("counts UTF-8 bytes and closes instead of growing live traffic forever", () => {
    const h = harness();
    h.setBuffered(256 * 1024);
    h.queue.send("é".repeat(4 * 1024 * 1024));
    expect(h.terminated()).toBe(0);
    h.queue.send("x");
    expect(h.terminated()).toBe(1);
    h.tick();
    expect(h.sent).toEqual([]);
    expect(h.queue.send("later")).toBe(0);
  });

  test("closes on dropped frames and disposes pending producers", () => {
    const h = harness();
    let closed = false;
    h.queue.replay(
      (function* () {
        try {
          yield "lost";
          yield "never";
        } finally {
          closed = true;
        }
      })(),
    );
    h.setResult(0);
    h.tick();
    expect(h.terminated()).toBe(1);
    expect(closed).toBe(true);
    h.queue.drain();
    h.tick();
    expect(h.sent).toEqual(["lost"]);
  });
});
