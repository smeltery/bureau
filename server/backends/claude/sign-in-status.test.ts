import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createClaudeSignInProbe, parseClaudeAuthStatus, runClaudeAuthStatus } from "./sign-in-status.ts";

const root = mkdtempSync(join(tmpdir(), "bureau-sign-in-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));
const env = { CLAUDE_CONFIG_DIR: root };

describe("Claude local sign-in status", () => {
  test("requires matching exit code and JSON evidence", () => {
    expect(parseClaudeAuthStatus(0, '{"loggedIn":true}')).toBe("signed_in");
    expect(parseClaudeAuthStatus(1, '{"loggedIn":false}')).toBe("signed_out");
    for (const [code, output] of [
      [0, '{"loggedIn":false}'],
      [1, '{"loggedIn":true}'],
      [2, '{"loggedIn":false}'],
      [null, '{"loggedIn":false}'],
      [0, "null"],
      [0, "broken"],
    ] as const) {
      expect(parseClaudeAuthStatus(code, output)).toBe("unknown");
    }
    expect(parseClaudeAuthStatus(1, '{"loggedIn":false}', true)).toBe("unknown");
  });

  test("shares concurrent probes but refreshes after a new login", async () => {
    let calls = 0;
    let signedIn = false;
    const probe = createClaudeSignInProbe({
      platform: "darwin",
      run: async () => {
        calls++;
        return signedIn ? "signed_in" : "signed_out";
      },
    });
    expect(await Promise.all([probe(env), probe(env, true)])).toEqual(["signed_out", "signed_out"]);
    expect(calls).toBe(1);
    signedIn = true;
    expect(await probe(env)).toBe("signed_out");
    expect(await probe(env, true)).toBe("signed_in");
    expect(calls).toBe(2);
  });

  test("isolates effective environments and expires settled results", async () => {
    let now = 0;
    let calls = 0;
    const probe = createClaudeSignInProbe({
      platform: "darwin",
      now: () => now,
      run: async () => {
        calls++;
        return "signed_out";
      },
    });
    await probe({ ...env, HOME: "/first" });
    await probe({ ...env, HOME: "/second" });
    expect(calls).toBe(2);
    now = 15_001;
    await probe({ ...env, HOME: "/first" });
    expect(calls).toBe(3);
  });

  test("does not cache uncertainty or reject on a failed probe", async () => {
    let calls = 0;
    const probe = createClaudeSignInProbe({
      platform: "darwin",
      run: async () => {
        calls++;
        throw new Error("unavailable");
      },
    });
    expect(await probe(env)).toBe("unknown");
    expect(await probe(env)).toBe("unknown");
    expect(calls).toBe(2);
  });

  test("uses direct credentials and non-macOS file evidence without spawning", async () => {
    const run = async (): Promise<never> => {
      throw new Error("must not run");
    };
    expect(await createClaudeSignInProbe({ platform: "darwin", run })({ ...env, CLAUDE_CODE_OAUTH_TOKEN: "test" })).toBe("signed_in");
    expect(await createClaudeSignInProbe({ platform: "linux", run })(env)).toBe("signed_out");
  });

  test("bounds a stuck CLI and treats missing binaries as unknown", async () => {
    const executable = join(root, "auth-status");
    writeFileSync(executable, "#!/bin/sh\nexec sleep 30\n", { mode: 0o700 });
    const started = Date.now();
    expect(await runClaudeAuthStatus(env, executable, 30)).toBe("unknown");
    expect(Date.now() - started).toBeLessThan(2000);
    expect(await runClaudeAuthStatus(env, join(root, "missing"))).toBe("unknown");
  });
});
