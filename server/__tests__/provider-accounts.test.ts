import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import {
  acquireSignInSlot,
  buildProviderProbeEnv,
  invalidateProviderAccountCache,
  listProviderAccounts,
  releaseSignInSlot,
  resetSignInSlotsForTests,
  setProviderKeys,
  setProviderProbeFnsForTests,
} from "../provider-accounts/index.ts";
import { claimUserByName, updateUser, getUserById } from "../users.ts";
import { managedUserEnvPath, readManagedUserEnv } from "../persistence/managed-env.ts";

afterEach(() => {
  resetSignInSlotsForTests();
});

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

  test("setProviderKeys merges without wiping other variables", async () => {
    const user = claimUserByName(`Keys Merge ${crypto.randomUUID()}`);
    const first = await setProviderKeys(user.id, { anthropicApiKey: "sk-ant-one" });
    expect(first.ok).toBe(true);
    const second = await setProviderKeys(user.id, { openaiApiKey: "sk-openai-two" });
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

  test("listProviderAccounts reflects hasApiKey after write", async () => {
    const user = claimUserByName(`List After ${crypto.randomUUID()}`);
    await setProviderKeys(user.id, { openaiApiKey: "sk-list-test" });
    invalidateProviderAccountCache(user.id);
    const listed = await listProviderAccounts(user.id, true);
    const codex = listed.accounts.find((a) => a.provider === "codex");
    expect(codex?.hasApiKey).toBe(true);
    expect(codex?.accountStatus).toBe("connected");
    expect(JSON.stringify(listed)).not.toContain("sk-list-test");
  });

  test("listProviderAccounts labels Claude cloud selection as connected", async () => {
    const user = claimUserByName(`Claude Cloud ${crypto.randomUUID()}`);
    await setProviderKeys(user.id, {});
    const dir = mkdtempSync(join(tmpdir(), "bureau-provider-cloud-"));
    const envPath = join(dir, "user.env");
    writeFileSync(envPath, "CLAUDE_CODE_USE_BEDROCK=1\n");
    const actor = getUserById(user.id)!;
    updateUser(actor, user.id, { envFile: envPath }, []);
    invalidateProviderAccountCache(user.id);

    const listed = await listProviderAccounts(user.id, true);
    const claude = listed.accounts.find((a) => a.provider === "claude");
    expect(claude?.accountStatus).toBe("connected");
    expect(claude?.accountLabel).toBe("Amazon Bedrock");
    expect(claude?.authVia).toBe("none");
  });

  test("recognizes personal Claude tokens without returning their values", async () => {
    const user = claimUserByName(`Claude Token ${crypto.randomUUID()}`);
    const dir = mkdtempSync(join(tmpdir(), "bureau-provider-token-"));
    const envPath = join(dir, "user.env");
    writeFileSync(envPath, "ANTHROPIC_API_KEY=\nCLAUDE_CODE_USE_BEDROCK=0\nCLAUDE_CODE_USE_VERTEX=0\nCLAUDE_CODE_OAUTH_TOKEN=test-private-token\n");
    updateUser(getUserById(user.id)!, user.id, { envFile: envPath }, []);
    const listed = await listProviderAccounts(user.id, true);
    expect(listed.accounts.find((account) => account.provider === "claude")).toMatchObject({ accountStatus: "connected", accountLabel: "Environment token", hasApiKey: false });
    expect(JSON.stringify(listed)).not.toContain("test-private-token");
  });

  test("timed-out probes settle as unavailable, keep sign-in, and are not cached", async () => {
    const user = claimUserByName(`Probe Timeout ${crypto.randomUUID()}`);
    invalidateProviderAccountCache(user.id);
    const pending: Array<() => void> = [];
    const restore = setProviderProbeFnsForTests({
      probeClaude: () => new Promise(() => {}),
      probeCodex: async () => ({
        provider: "codex",
        accountStatus: "not_connected",
        authVia: "none",
        hasApiKey: false,
        hostHints: ["codex login"],
        canOfferSignIn: true,
      }),
      scheduleTimeout: (onTimeout) => {
        let cancelled = false;
        pending.push(() => {
          if (!cancelled) onTimeout();
        });
        return () => {
          cancelled = true;
        };
      },
    });
    try {
      const listedPromise = listProviderAccounts(user.id, true);
      expect(pending.length).toBe(2);
      for (const fire of pending.splice(0)) fire();
      const listed = await listedPromise;
      const claude = listed.accounts.find((a) => a.provider === "claude");
      expect(claude?.accountStatus).toBe("unavailable");
      expect(claude?.canOfferSignIn).toBe(true);
      expect(claude?.hostHints.length).toBeGreaterThan(0);

      // A later read must not reuse a timed-out cache entry.
      const restoreFast = setProviderProbeFnsForTests({
        probeClaude: async () => ({
          provider: "claude",
          accountStatus: "not_connected",
          authVia: "none",
          hasApiKey: false,
          hostHints: ["claude"],
          canOfferSignIn: true,
        }),
        scheduleTimeout: () => () => {},
      });
      try {
        const again = await listProviderAccounts(user.id, false);
        expect(again.accounts.find((a) => a.provider === "claude")?.accountStatus).toBe("not_connected");
      } finally {
        restoreFast();
      }
    } finally {
      restore();
    }
  });

  test("sign-in slot surfaces as a live queue and blocks a second member", async () => {
    const first = claimUserByName(`Slot First ${crypto.randomUUID()}`);
    const second = claimUserByName(`Slot Second ${crypto.randomUUID()}`);
    const acquired = acquireSignInSlot(first.id, "claude");
    expect(acquired.ok).toBe(true);

    const listed = await listProviderAccounts(second.id, true);
    const claude = listed.accounts.find((a) => a.provider === "claude");
    expect(claude?.loginQueue).toEqual({
      holderName: first.name,
      startedAt: acquired.ok ? acquired.slot.startedAt : 0,
    });

    const blocked = acquireSignInSlot(second.id, "claude");
    expect(blocked.ok).toBe(false);
    if (blocked.ok) return;
    expect(blocked.code).toBe("shared_login_in_progress");
    expect(blocked.detail.holderName).toBe(first.name);

    expect(releaseSignInSlot(second.id, "claude")).toBe(false);
    expect(releaseSignInSlot(first.id, "claude")).toBe(true);
    const after = await listProviderAccounts(second.id, true);
    expect(after.accounts.find((a) => a.provider === "claude")?.loginQueue).toBeUndefined();
  });

  test("owner can cancel another member's sign-in slot", () => {
    const holder = claimUserByName(`Slot Holder ${crypto.randomUUID()}`);
    const owner = claimUserByName(`Slot Owner ${crypto.randomUUID()}`);
    expect(acquireSignInSlot(holder.id, "codex").ok).toBe(true);
    expect(releaseSignInSlot(owner.id, "codex", true)).toBe(true);
    expect(releaseSignInSlot(owner.id, "codex", true)).toBe(false);
  });
});
