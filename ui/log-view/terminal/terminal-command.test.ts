import { describe, expect, test } from "bun:test";
import { commandInputBytes } from "./terminal-command.ts";

describe("commandInputBytes", () => {
  test("clears the current prompt line before typing the command", () => {
    expect(commandInputBytes("sudo systemctl restart bureau")).toBe("\x05\x15sudo systemctl restart bureau");
  });
});
