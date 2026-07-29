import { afterEach, describe, expect, spyOn, test } from "bun:test";
import type { ServerWebSocket } from "bun";
import type { ClientCommand } from "../../shared/types.ts";
import { dispatchBrowserCommand } from "./command-dispatch.ts";

const consoleError = spyOn(console, "error").mockImplementation(() => {});

afterEach(() => {
  consoleError.mockClear();
});

describe("dispatchBrowserCommand", () => {
  test("contains async command handler failures at the websocket seam", async () => {
    const seen: ClientCommand[] = [];

    await expect(
      dispatchBrowserCommand({} as ServerWebSocket<never>, JSON.stringify({ type: "ping" }), async (cmd) => {
        seen.push(cmd);
        throw new Error("handler exploded");
      }),
    ).resolves.toBeUndefined();

    expect(seen).toEqual([{ type: "ping" }]);
    expect(consoleError).toHaveBeenCalledTimes(1);
    expect(consoleError.mock.calls[0]?.[0]).toBe("Invalid command:");
  });
});
