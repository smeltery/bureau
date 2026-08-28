import { describe, expect, test } from "bun:test";
import { createTerminalFinalizer } from "./terminal-finalizer.ts";

describe("createTerminalFinalizer", () => {
  test("detaches and emits once when the sidecar is current", () => {
    const events: number[] = [];
    let detached = 0;
    const finalize = createTerminalFinalizer({
      isCurrent: () => true,
      detach: () => detached++,
      emitExit: (exitCode) => events.push(exitCode),
    });

    finalize(1);
    finalize(2);

    expect(detached).toBe(1);
    expect(events).toEqual([1]);
  });

  test("ignores a late exit from a replaced sidecar", () => {
    const events: number[] = [];
    let detached = 0;
    const finalize = createTerminalFinalizer({
      isCurrent: () => false,
      detach: () => detached++,
      emitExit: (exitCode) => events.push(exitCode),
    });

    finalize(1);

    expect(detached).toBe(0);
    expect(events).toEqual([]);
  });
});
