import { afterEach, describe, expect, it } from "bun:test";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

import { JsonRpcLiteClient } from "./client.ts";

const tmpDirs: string[] = [];

afterEach(() => {
  for (const dir of tmpDirs.splice(0)) {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {}
  }
});

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code !== "ESRCH";
  }
}

async function waitFor(predicate: () => boolean, timeoutMs: number, intervalMs = 25): Promise<boolean> {
  const start = Date.now();
  for (;;) {
    if (predicate()) return true;
    if (Date.now() - start >= timeoutMs) return false;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}

function writeFakeLauncher(dir: string): string {
  const script = join(dir, "fake-codex.sh");
  writeFileSync(script, ["#!/usr/bin/env bash", 'if [ "$1" = "ignore" ]; then trap "" TERM INT; fi', "sleep 600 &", 'echo "$!" > "$GC_PIDFILE"', "wait", ""].join("\n"));
  chmodSync(script, 0o755);
  return script;
}

function makeClient(args: string[]): {
  client: JsonRpcLiteClient;
  pidFile: string;
} {
  const dir = mkdtempSync(join(tmpdir(), "codex-client-test-"));
  tmpDirs.push(dir);
  const pidFile = join(dir, "grandchild.pid");
  const client = new JsonRpcLiteClient({
    codexBin: writeFakeLauncher(dir),
    args,
    cwd: dir,
    env: { ...process.env, GC_PIDFILE: pidFile },
  });
  return { client, pidFile };
}

async function readGrandchildPid(pidFile: string): Promise<number> {
  const ok = await waitFor(() => {
    try {
      return readFileSync(pidFile, "utf8").trim().length > 0;
    } catch {
      return false;
    }
  }, 4000);
  if (!ok) throw new Error("grandchild never reported its pid");
  return Number(readFileSync(pidFile, "utf8").trim());
}

describe("JsonRpcLiteClient.close", () => {
  for (const args of [undefined, ["app-server", "-c", "analytics.enabled=true"]]) {
    it(`pins analytics off on the subprocess argv (${args ? "custom" : "default"} args)`, async () => {
      const dir = mkdtempSync(join(tmpdir(), "codex-telemetry-test-"));
      tmpDirs.push(dir);
      const argvFile = join(dir, "argv");
      const bin = join(dir, "codex.sh");
      writeFileSync(bin, '#!/bin/sh\nprintf "%s\\n" "$@" > "$ARGV_FILE"\nexec sleep 600\n');
      chmodSync(bin, 0o755);
      const client = new JsonRpcLiteClient({
        codexBin: bin,
        args,
        env: { ...process.env, ARGV_FILE: argvFile },
      });
      try {
        client.start();
        expect(
          await waitFor(() => {
            try {
              return readFileSync(argvFile, "utf8").includes("analytics.enabled");
            } catch {
              return false;
            }
          }, 4000),
        ).toBe(true);
        expect(readFileSync(argvFile, "utf8").trim().split("\n")).toEqual([...(args ?? ["app-server", "--listen", "stdio://"]), "-c", "analytics.enabled=false"]);
      } finally {
        await client.close();
      }
    }, 10000);
  }

  it("kills a SIGTERM-ignoring launcher and its child process", async () => {
    const { client, pidFile } = makeClient(["ignore"]);
    client.start();
    const launcherPid = client.pid();
    expect(launcherPid).toBeDefined();
    const grandchildPid = await readGrandchildPid(pidFile);

    expect(isAlive(launcherPid!)).toBe(true);
    expect(isAlive(grandchildPid)).toBe(true);

    await client.close();

    expect(await waitFor(() => !isAlive(launcherPid!), 6000)).toBe(true);
    expect(await waitFor(() => !isAlive(grandchildPid), 6000)).toBe(true);
  }, 10000);

  it("reaps a well-behaved launcher promptly", async () => {
    const { client, pidFile } = makeClient(["default"]);
    client.start();
    const launcherPid = client.pid();
    expect(launcherPid).toBeDefined();
    const grandchildPid = await readGrandchildPid(pidFile);

    expect(isAlive(launcherPid!)).toBe(true);
    expect(isAlive(grandchildPid)).toBe(true);

    await client.close();

    expect(await waitFor(() => !isAlive(launcherPid!) && !isAlive(grandchildPid), 1500)).toBe(true);
  }, 10000);
});
