// The office server renames its own process so that out-of-memory protection
// can shield it by name without also shielding agent builds.
//
// These run in real subprocesses on purpose. /proc/self/comm is per-thread and
// the rename is a live kernel side effect, so asserting it in-process would
// rename the test runner itself.

import { describe, expect, test } from "bun:test";
import { readFileSync } from "fs";
import { OFFICE_PROCESS_NAME, setProcessName } from "./process-name.ts";

const MODULE = `${import.meta.dir}/process-name.ts`;

/** Run `code` in a fresh bun process and return its trimmed stdout. */
async function inSubprocess(code: string): Promise<string> {
  const proc = Bun.spawn(["bun", "-e", code], {
    stdout: "pipe",
    stderr: "pipe",
  });
  const [out, err] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
  const exit = await proc.exited;
  if (exit !== 0) throw new Error(`subprocess exited ${exit}: ${err}`);
  return out.trim();
}

/** Field 2 of /proc/PID/stat is the process name, in parentheses. */
const READ_STAT_NAME = `readFileSync("/proc/self/stat","utf8").split(" ")[1]`;

describe("setProcessName", () => {
  test.skipIf(process.platform !== "linux")("renames the running process as the kernel reports it", async () => {
    const out = await inSubprocess(`
      const { readFileSync } = require("fs");
      const { setProcessName } = await import("${MODULE}");
      const before = readFileSync("/proc/self/comm", "utf8").trim();
      const ok = setProcessName();
      const comm = readFileSync("/proc/self/comm", "utf8").trim();
      console.log(JSON.stringify({ before, ok, comm, stat: ${READ_STAT_NAME} }));
    `);
    const got = JSON.parse(out);
    expect(got.before).toBe("bun");
    expect(got.ok).toBe(true);
    // Both readbacks matter: /proc/PID/comm is the interface we write, and
    // /proc/PID/stat is the one earlyoom actually parses to pick a victim.
    expect(got.comm).toBe(OFFICE_PROCESS_NAME);
    expect(got.stat).toBe(`(${OFFICE_PROCESS_NAME})`);
  });

  test.skipIf(process.platform !== "linux")("a bun child of a renamed server is still named bun", async () => {
    const out = await inSubprocess(`
      const { setProcessName } = await import("${MODULE}");
      setProcessName();
      // An agent's build is a bun process exec'd below the server. It must stay
      // named "bun" so shielding "bureau" does not shield it.
      const child = Bun.spawn(
        ["bun", "-e", 'process.stdout.write(require("fs").readFileSync("/proc/self/comm", "utf8"))'],
        { stdout: "pipe", stderr: "pipe" },
      );
      const text = await new Response(child.stdout).text();
      const exit = await child.exited;
      if (exit !== 0) throw new Error("child exit " + exit);
      console.log(text.trim());
    `);
    expect(out).toBe("bun");
  });

  test.skipIf(process.platform !== "linux")("truncates to the 15 characters the kernel stores", async () => {
    const out = await inSubprocess(`
      const { readFileSync } = require("fs");
      const { setProcessName } = await import("${MODULE}");
      setProcessName("aaaaaaaaaaaaaaaaaaaaaa");
      console.log(readFileSync("/proc/self/comm", "utf8").trim());
    `);
    expect(out).toBe("a".repeat(15));
  });

  test.skipIf(process.platform === "linux")("is a no-op off Linux", () => {
    expect(setProcessName()).toBe(false);
  });

  test("OFFICE_PROCESS_NAME is bureau (not bun)", () => {
    expect(OFFICE_PROCESS_NAME).toBe("bureau");
    expect(OFFICE_PROCESS_NAME).not.toBe("bun");
    expect(OFFICE_PROCESS_NAME.length).toBeLessThanOrEqual(15);
  });
});

describe("wiring", () => {
  test("server/index.ts calls setProcessName near oom stamping", () => {
    const src = readFileSync(`${import.meta.dir}/index.ts`, "utf8");
    expect(src).toContain('import { setProcessName } from "./process-name.ts"');
    expect(src).toContain("setProcessName()");
    // After the owner-login CLI fast-path, before/with oom stamping — not at
    // import of an unrelated module.
    const cliExit = src.indexOf('Bun.argv[2] === "owner-login"');
    const rename = src.indexOf("setProcessName()");
    const stamp = src.indexOf("startAgentOomStamping()");
    expect(cliExit).toBeGreaterThanOrEqual(0);
    expect(rename).toBeGreaterThan(cliExit);
    expect(stamp).toBeGreaterThan(rename);
  });
});
