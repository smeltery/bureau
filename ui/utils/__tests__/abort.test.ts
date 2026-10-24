import { expect, test } from "bun:test";

test("stops immediately after page load and debounces each agent independently", () => {
  // Isolate the transport shim and monotonic clock from other UI tests.
  const result = Bun.spawnSync(
    [
      process.execPath,
      "--eval",
      `
      import { expect, spyOn } from "bun:test";
      import { setShim } from "./ui/ws.ts";
      import { sendAbortDebounced } from "./ui/utils/abort.ts";
      const commands = [];
      setShim(command => commands.push(command));
      const clock = spyOn(performance, "now").mockReturnValue(0);
      sendAbortDebounced("first");
      expect(commands).toEqual([{type:"abort", agentId:"first"}]);
      sendAbortDebounced("first");
      clock.mockReturnValue(100);
      sendAbortDebounced("second");
      expect(commands).toEqual([{type:"abort", agentId:"first"}, {type:"abort", agentId:"second"}]);
      clock.mockReturnValue(1999);
      sendAbortDebounced("first");
      expect(commands.length).toBe(2);
      clock.mockReturnValue(2000);
      sendAbortDebounced("first");
      sendAbortDebounced("second");
      expect(commands.length).toBe(3);
      clock.mockReturnValue(2100);
      sendAbortDebounced("second");
      expect(commands.slice(2)).toEqual([{type:"abort", agentId:"first"}, {type:"abort", agentId:"second"}]);
      clock.mockRestore();
      `,
    ],
    { cwd: new URL("../../../", import.meta.url).pathname, stdout: "pipe", stderr: "pipe", timeout: 10000 },
  );
  expect(result.exitCode, result.stderr.toString()).toBe(0);
});
