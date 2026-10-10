import assert from "node:assert/strict";
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { claim, exerciseOffice, waitForHttp } from "./client.ts";

const mode = process.argv[2] ?? "local";
const origins: Record<string, string | null> = {
  local: null,
  private: "https://private.tailnet.test",
  funnel: "https://office.tailnet.test",
  domain: "https://office.example.test",
  vps: "https://vps.example.test",
};
assert.ok(mode in origins, "Choose local, private, funnel, domain or vps");
const home = realpathSync(mkdtempSync(join(tmpdir(), "bureau-install-")));
const reservation = Bun.serve({ port: 0, fetch: () => new Response() });
const port = reservation.port;
await reservation.stop(true);
const base = `http://localhost:${port}`;
// Explicit allowlist: never inherit the operator's provider credentials,
// configuration roots, startup files, office data, or provider endpoints.
const env = {
  PATH: process.env.PATH,
  HOME: home,
  USER: "bureau-install",
  SHELL: "/bin/bash",
  LANG: "en_US.UTF-8",
  PORT: String(port),
  BUREAU_HOME: join(home, ".bureau"),
  CLAUDE_CONFIG_DIR: join(home, ".claude"),
  ANTHROPIC_BASE_URL: "http://127.0.0.1:9",
  OPENAI_BASE_URL: "http://127.0.0.1:9",
};
let child: ReturnType<typeof Bun.spawn> | undefined;
const start = () => {
  child = Bun.spawn([process.execPath, "server/index.ts"], { env, stdout: "inherit", stderr: "inherit" });
};
const stop = async () => {
  if (child) {
    child.kill("SIGTERM");
    await child.exited;
    child = undefined;
  }
};
try {
  start();
  const cookie = await claim(base, base);
  const origin = origins[mode];
  if (origin) {
    const response = await fetch(base + "/api/office/access", {
      method: "PUT",
      headers: { cookie, origin: base, "x-forwarded-for": "127.0.0.1", "content-type": "application/json" },
      body: JSON.stringify({ externalAccess: true, publicOrigin: origin, previewAllowHosts: [] }),
    });
    assert.equal(response.status, 200, await response.clone().text());
    await stop();
    start();
    await waitForHttp(base, "/readyz");
  }
  await exerciseOffice(base, origin ?? base, cookie, home);
  console.log(`PASS: ${mode} entrypoint with disposable HOME`);
} finally {
  await stop();
  rmSync(home, { recursive: true, force: true });
}
