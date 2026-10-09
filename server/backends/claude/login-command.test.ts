import { afterAll, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { claudeLoginCommand } from "./login-command.ts";

const root = mkdtempSync(join(tmpdir(), "bureau-login-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));

test("bundled login works without PATH and quotes credential paths literally", () => {
  const binary = join(root, "Claude's CLI");
  writeFileSync(binary, `#!${process.execPath}\nconsole.log(JSON.stringify({args:process.argv.slice(2),home:process.env.HOME,config:process.env.CLAUDE_CONFIG_DIR}));\n`, { mode: 0o700 });
  const env = { PATH: "/unavailable", HOME: "/tmp/a home", CLAUDE_CONFIG_DIR: "/tmp/$(echo unsafe)'quoted", ANTHROPIC_API_KEY: "do-not-print" };
  const command = claudeLoginCommand(env, binary)!;
  expect(command).not.toContain(env.ANTHROPIC_API_KEY);
  const result = Bun.spawnSync(["/bin/sh", "-c", command]);
  expect(result.exitCode).toBe(0);
  expect(JSON.parse(result.stdout.toString())).toEqual({ args: ["auth", "login"], home: env.HOME, config: env.CLAUDE_CONFIG_DIR });
});

test("host fallback honors the effective PATH and a missing CLI has no install command", () => {
  const host = join(root, "claude");
  writeFileSync(host, "#!/bin/sh\nexit 0\n", { mode: 0o700 });
  expect(claudeLoginCommand({ PATH: root }, join(root, "missing"))).toBe(`'${host}' auth login`);
  expect(claudeLoginCommand({ PATH: "/unavailable" }, join(root, "missing"))).toBeNull();
});
