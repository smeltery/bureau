import { expect, test } from "bun:test";
import { createTerminalResizer } from "./terminal-resize.ts";

function fixture() {
  let now = 0;
  const timers = new Map<() => void, number>();
  const sent: number[][] = [];
  const resizer = createTerminalResizer(
    (cols, rows) => sent.push([cols, rows]),
    (callback, delayMs) => {
      timers.set(callback, now + delayMs);
      return () => timers.delete(callback);
    },
  );
  return {
    resizer,
    sent,
    advance(ms: number) {
      now += ms;
      for (const [callback, deadline] of timers) {
        if (deadline <= now) {
          timers.delete(callback);
          callback();
        }
      }
    },
  };
}

test("a drag sends only its final size after settling", () => {
  const f = fixture();
  f.resizer.sendNow(80, 24);
  f.resizer.request(90, 24);
  f.advance(100);
  f.resizer.request(100, 30);
  f.advance(119);
  expect(f.sent).toEqual([[80, 24]]);
  f.advance(1);
  expect(f.sent).toEqual([
    [80, 24],
    [100, 30],
  ]);
});

test("returning to the shell's current size cancels intermediate changes", () => {
  const f = fixture();
  f.resizer.sendNow(80, 24);
  f.resizer.request(100, 30);
  f.resizer.request(80, 24);
  f.advance(200);
  f.resizer.request(80, 24);
  f.advance(200);
  expect(f.sent).toEqual([[80, 24]]);
});

test("finishing a pinch sends immediately and supersedes a pending drag", () => {
  const f = fixture();
  f.resizer.request(100, 30);
  f.resizer.sendNow(60, 20);
  expect(f.sent).toEqual([[60, 20]]);
  f.advance(200);
  expect(f.sent).toEqual([[60, 20]]);
});

test("a replacement shell receives the current size even if unchanged", () => {
  const f = fixture();
  f.resizer.sendNow(100, 30);
  f.resizer.sendNow(100, 30, true);
  expect(f.sent).toEqual([
    [100, 30],
    [100, 30],
  ]);
});

test("closing or switching terminals cancels pending sends", () => {
  const f = fixture();
  f.resizer.request(100, 30);
  f.resizer.dispose();
  f.advance(200);
  f.resizer.request(80, 24);
  f.resizer.sendNow(80, 24, true);
  f.advance(200);
  expect(f.sent).toEqual([]);
});
