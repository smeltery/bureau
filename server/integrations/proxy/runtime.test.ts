import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createIntegrationStore } from "../store.ts";
import { createCredentialRuntime, appendGitCredentialHelpers } from "./runtime.ts";
import { injectCredentials, secretPlaceholder } from "./credentials.ts";
import { scrubBuffer, secretPatterns } from "./scrub.ts";

test("scoped environments carry stand-ins, preserve rotation and invalidate reissued credentials", async () => {
  const root = mkdtempSync(join(tmpdir(), "bureau-integrations-runtime-"));
  const store = createIntegrationStore(root);
  const runtime = createCredentialRuntime(store, root);
  const scope = { kind: "office" as const };
  try {
    await runtime.enable();
    expect(runtime.environment("member-a")).toBeNull();
    store.setSecret(scope, "GH_TOKEN", { value: "ghp_originalprivatecredential123456789", hosts: ["github.com"], form: { kind: "authorization" } });
    store.setSecret({ kind: "member", userId: "member-b" }, "OTHER_TOKEN", { value: "other-private-credential", hosts: ["api.example.test"], form: { kind: "authorization" } });
    await runtime.refresh();
    const first = runtime.environment("member-a")!;
    expect(first.member).toEqual({});
    expect(first.office.GH_TOKEN).not.toContain("originalprivate");
    expect(first.fixed.HTTPS_PROXY).toMatch(/^http:\/\/127\.0\.0\.1:/);
    store.setSecret(scope, "GH_TOKEN", { value: "ghp_rotatedprivatecredential1234567890" });
    expect(runtime.environment("member-a")!.office.GH_TOKEN).toBe(first.office.GH_TOKEN);
    store.reissue(scope, "GH_TOKEN");
    expect(runtime.environment("member-a")!.office.GH_TOKEN).not.toBe(first.office.GH_TOKEN);
    store.remove(scope, "secrets", "GH_TOKEN");
    expect(runtime.environment("member-a")).toBeNull();
    expect(runtime.environment("member-b")!.member.OTHER_TOKEN).toBeDefined();
    const env: Record<string, string | undefined> = { GIT_CONFIG_COUNT: "1", GIT_CONFIG_KEY_0: "color.ui", GIT_CONFIG_VALUE_0: "false" };
    appendGitCredentialHelpers(env, first.gitCredentials);
    expect(env.GIT_CONFIG_COUNT).toBe("3");
    expect(env.GIT_CONFIG_VALUE_0).toBe("false");
    const git = Bun.spawn(["git", "credential", "fill"], {
      env: { ...process.env, ...env, GIT_TERMINAL_PROMPT: "0" },
      stdin: new Blob(["protocol=https\nhost=github.com\n\n"]),
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(await new Response(git.stdout).text()).toContain(`password=${first.office.GH_TOKEN}`);
    expect(await git.exited).toBe(0);
  } finally {
    await runtime.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("reflected base64 credentials are scrubbed at every embedding alignment", () => {
  const value = "private-credential-long-enough";
  for (const prefix of ["", "x", "xx", "user:"]) {
    const encoded = Buffer.from(`${prefix}${value}:suffix`).toString("base64");
    expect(scrubBuffer(Buffer.from(encoded), secretPatterns([value])).toString()).toContain("[redacted]");
  }
});

test("revoked placeholders cannot resolve to a recreated secret", () => {
  const key = Buffer.alloc(32, 1);
  const scope = { kind: "office" as const };
  const secret = { name: "TOKEN", value: "private-long-token", hosts: ["api.example.test"], form: { kind: "authorization" as const }, note: "", createdAt: 1, updatedAt: 1, generation: "old" };
  const old = secretPlaceholder(key, scope, secret);
  const recreated = { ...secret, generation: "new" };
  const result = injectCredentials("api.example.test", { authorization: `Bearer ${old}` }, [{ scope, secret: recreated, placeholder: secretPlaceholder(key, scope, recreated) }]);
  expect(result.headers.authorization).toBe(`Bearer ${old}`);
  expect(result.used).toEqual([]);
});
