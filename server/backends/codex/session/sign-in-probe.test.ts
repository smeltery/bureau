import { afterAll, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CodexSignInProbe } from "./sign-in-probe.ts";

const directory = mkdtempSync(join(tmpdir(), "bureau-codex-sign-in-"));
const env = { CODEX_HOME: directory };
afterAll(() => rmSync(directory, { recursive: true, force: true }));

test("blocks only an explicit missing account that requires OpenAI auth", async () => {
  let status: { account?: unknown; requiresOpenaiAuth?: boolean } | null = { account: null, requiresOpenaiAuth: true };
  const probe = new CodexSignInProbe(async () => status);
  expect(await probe.check(env)).toBe(true);
  status = { account: { type: "chatgpt" }, requiresOpenaiAuth: true };
  expect(await probe.check(env)).toBe(false);
  for (const unknown of [null, {}, { account: null }, { account: null, requiresOpenaiAuth: false }]) {
    status = unknown;
    expect(await probe.check(env)).toBe(false);
  }
});

test("unknown or stalled account reads allow the backend and do not accumulate requests", async () => {
  let calls = 0;
  const probe = new CodexSignInProbe(() => {
    calls++;
    return new Promise(() => {});
  }, 10);
  expect(await probe.check(env)).toBe(false);
  expect(await probe.check(env)).toBe(false);
  expect(calls).toBe(1);
  expect(
    await new CodexSignInProbe(async () => {
      throw new Error("method unavailable");
    }).check(env),
  ).toBe(false);
});

test("recognizes new file or environment credentials before another account RPC", async () => {
  let calls = 0;
  const probe = new CodexSignInProbe(async () => {
    calls++;
    return { account: null, requiresOpenaiAuth: true };
  });
  expect(await probe.check(env)).toBe(true);
  expect(await probe.check({ ...env, OPENAI_API_KEY: "configured" })).toBe(false);
  writeFileSync(join(directory, "auth.json"), "{}");
  try {
    expect(await probe.check(env)).toBe(false);
    expect(calls).toBe(1);
  } finally {
    rmSync(join(directory, "auth.json"));
  }
  expect(await probe.check(env, new Error("authentication required"))).toBe(true);
  expect(await probe.check(env, new Error("binary missing"))).toBe(false);
});
