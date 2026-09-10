import { describe, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { buildProviderProbeEnv, listProviderAccounts, setProviderKeys, invalidateProviderAccountCache } from "../provider-accounts/index.ts";
import { claimUserByName, updateUser, getUserById } from "../users.ts";
import { managedUserEnvPath, readManagedUserEnv } from "../persistence/managed-env.ts";

describe("provider-accounts status + keys", () => {
  test("buildProviderProbeEnv merges user envFile over process", () => {
    const user = claimUserByName(`Probe Env ${crypto.randomUUID()}`);
    const dir = mkdtempSync(join(tmpdir(), "bureau-provider-"));
    const envPath = join(dir, "user.env");
    writeFileSync(envPath, "OPENAI_API_KEY=from-file\n");
    const actor = getUserById(user.id)!;
    updateUser(actor, user.id, { envFile: envPath }, []);
    const env = buildProviderProbeEnv(user.id);
    expect(env.OPENAI_API_KEY).toBe("from-file");
  });

  test("setProviderKeys merges without wiping other variables", () => {
    const user = claimUserByName(`Keys Merge ${crypto.randomUUID()}`);
    const first = setProviderKeys(user.id, { anthropicApiKey: "sk-ant-one" });
    expect(first.ok).toBe(true);
    const second = setProviderKeys(user.id, { openaiApiKey: "sk-openai-two" });
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.value.updated).toEqual(["OPENAI_API_KEY"]);
    expect(JSON.stringify(second.value)).not.toContain("sk-ant-one");
    expect(JSON.stringify(second.value)).not.toContain("sk-openai-two");
    const stored = readManagedUserEnv(user.id);
    expect(stored.ANTHROPIC_API_KEY).toBe("sk-ant-one");
    expect(stored.OPENAI_API_KEY).toBe("sk-openai-two");
    expect(second.envPath).toBe(managedUserEnvPath(user.id));
  });

  test("listProviderAccounts reflects hasApiKey after write", () => {
    const user = claimUserByName(`List After ${crypto.randomUUID()}`);
    setProviderKeys(user.id, { openaiApiKey: "sk-list-test" });
    invalidateProviderAccountCache(user.id);
    const listed = listProviderAccounts(user.id, true);
    const codex = listed.accounts.find((a) => a.provider === "codex");
    expect(codex?.hasApiKey).toBe(true);
    expect(codex?.accountStatus).toBe("connected");
    expect(JSON.stringify(listed)).not.toContain("sk-list-test");
  });

  test("listProviderAccounts labels Claude cloud selection as connected", () => {
    const user = claimUserByName(`Claude Cloud ${crypto.randomUUID()}`);
    setProviderKeys(user.id, {});
    const dir = mkdtempSync(join(tmpdir(), "bureau-provider-cloud-"));
    const envPath = join(dir, "user.env");
    writeFileSync(envPath, "CLAUDE_CODE_USE_BEDROCK=1\n");
    const actor = getUserById(user.id)!;
    updateUser(actor, user.id, { envFile: envPath }, []);
    invalidateProviderAccountCache(user.id);

    const listed = listProviderAccounts(user.id, true);
    const claude = listed.accounts.find((a) => a.provider === "claude");
    expect(claude?.accountStatus).toBe("connected");
    expect(claude?.accountLabel).toBe("Amazon Bedrock");
    expect(claude?.authVia).toBe("none");
  });
});
