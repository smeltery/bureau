import { afterEach, describe, expect, it } from "bun:test";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { OpenCodeSupervisor } from "../supervisor.ts";

const cleanup: Array<() => void | Promise<void>> = [];
afterEach(async () => {
  for (const dispose of cleanup.splice(0).reverse()) await dispose();
});

function fixture(launchEnv?: Record<string, string | undefined>) {
  const directory = mkdtempSync(join(tmpdir(), "bureau-opencode-health-"));
  cleanup.push(() => rmSync(directory, { recursive: true, force: true }));
  const binary = join(directory, "serve");
  writeFileSync(
    binary,
    `#!/usr/bin/env bun
let slow = false;
Bun.serve({ port: Number(process.argv[process.argv.indexOf("--port") + 1]), hostname: "127.0.0.1", async fetch(req) {
  if (new URL(req.url).pathname === "/slow") { slow = true; return Response.json({ ok: true }); }
  if (new URL(req.url).pathname === "/env") return Response.json({ agentToken: process.env.BUREAU_AGENT_TOKEN ?? null, appToken: process.env.BUREAU_APP_TOKEN ?? null, providerKey: process.env.OPENCODE_API_KEY, path: process.env.PATH, home: process.env.HOME });
  if (slow) await Bun.sleep(2500);
  return Response.json({ healthy: true });
}});
`,
    { mode: 0o700 },
  );
  const supervisor = new OpenCodeSupervisor({ launchEnv: { ...launchEnv, OPENCODE_BINARY: binary }, profileDir: join(directory, "profile") });
  cleanup.push(() => supervisor.shutdown());
  return supervisor;
}

describe("OpenCode shared server recovery", () => {
  it("preserves a live process whose health request times out", async () => {
    const supervisor = fixture();
    const first = await supervisor.acquire();
    await first.beginTurn();
    await fetch(`${first.baseUrl}/slow`);
    const second = await supervisor.acquire();
    expect(second.pid).toBe(first.pid);
    await second.beginTurn();
    expect(second.pid).toBe(first.pid);
    second.endTurn();
    first.endTurn();
    second.release();
    first.release();
  }, 10_000);

  it("defers replacement until all active peers finish", async () => {
    const supervisor = fixture();
    const first = await supervisor.acquire();
    const second = await supervisor.acquire();
    await first.beginTurn();
    await second.beginTurn();
    const originalPid = first.pid;
    first.markUnresponsive!();
    await expect(first.recoverBeforePrompt()).rejects.toThrow("active turn");
    await expect(supervisor.acquire()).rejects.toThrow("another turn");
    expect(first.pid).toBe(originalPid);
    first.endTurn();
    second.endTurn();
    first.release();
    second.release();
    const replacement = await supervisor.acquire();
    expect(replacement.pid).not.toBe(originalPid);
    replacement.release();
  });
});

it("keeps office bearers out of the shared child while honoring launch configuration", async () => {
  const inherited = process.env.BUREAU_APP_TOKEN;
  process.env.BUREAU_APP_TOKEN = "app-secret-fixture";
  const path = `${process.env.PATH}:/bureau-test-path`;
  try {
    const supervisor = fixture({ BUREAU_AGENT_TOKEN: "agent-secret-fixture", OPENCODE_API_KEY: "provider-key-fixture", PATH: path });
    const lease = await supervisor.acquire();
    const env = await (await fetch(`${lease.baseUrl}/env`)).json();
    expect(env).toEqual({ agentToken: null, appToken: null, providerKey: "provider-key-fixture", path, home: join(supervisor.profileDir, "home") });
    lease.release();
  } finally {
    if (inherited === undefined) delete process.env.BUREAU_APP_TOKEN;
    else process.env.BUREAU_APP_TOKEN = inherited;
  }
});
