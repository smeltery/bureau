import { describe, expect, it } from "bun:test";
import { createPreviewQueue } from "./previewQueue.ts";

describe("app preview queue", () => {
  it("runs one capture at a time in view order", async () => {
    const queue = createPreviewQueue();
    const events: string[] = [];
    let releaseFirst!: () => void;
    const first = new Promise<void>((resolve) => (releaseFirst = resolve));
    queue.enqueue(async () => {
      events.push("a:start");
      await first;
      events.push("a:end");
    });
    queue.enqueue(async () => {
      events.push("b:start");
      events.push("b:end");
    });
    await Promise.resolve();
    expect(events).toEqual(["a:start"]);
    releaseFirst();
    await first;
    await Promise.resolve();
    await Promise.resolve();
    expect(events).toEqual(["a:start", "a:end", "b:start", "b:end"]);
  });
});
