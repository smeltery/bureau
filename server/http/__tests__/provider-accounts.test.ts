import { describe, expect, test } from "bun:test";
import type { AuthResult } from "../../auth/auth-middleware.ts";
import { claimUserByName } from "../../users.ts";
import { readManagedUserEnv } from "../../persistence/managed-env.ts";
import { invalidateProviderAccountCache } from "../../provider-accounts/index.ts";
import { handleProviderAccountsRequest } from "../provider-accounts.ts";

function authFor(userId: string, username: string, role: "owner" | "member" = "owner"): AuthResult {
  return {
    kind: "ok",
    session: {
      sessionIdHash: "hash",
      sessionPrefix: "sess",
      userId,
      username,
      role,
      needsRolling: false,
      absoluteExpiresAt: Date.now() + 86_400_000,
    },
  };
}

function request(path: string, init: RequestInit = {}): Request {
  return new Request(`http://local.test${path}`, {
    ...init,
    headers: {
      ...(init.body ? { "Content-Type": "application/json" } : {}),
      ...init.headers,
    },
  });
}

describe("handleProviderAccountsRequest", () => {
  test("returns null for unrelated routes", async () => {
    const user = claimUserByName(`Conn Unrelated ${crypto.randomUUID()}`);
    const req = request("/api/office/env");
    await expect(handleProviderAccountsRequest(req, new URL(req.url), authFor(user.id, user.name))).resolves.toBeNull();
  });

  test("requires a browser session", async () => {
    const req = request("/api/me/provider-accounts");
    const res = await handleProviderAccountsRequest(req, new URL(req.url), { kind: "loopback" });
    expect(res?.status).toBe(401);
    expect(await res?.json()).toEqual({ error: "authenticated browser session required" });
  });

  test("lists Claude and Codex status without secrets", async () => {
    const user = claimUserByName(`Conn List ${crypto.randomUUID()}`);
    invalidateProviderAccountCache(user.id);
    const req = request("/api/me/provider-accounts");
    const res = await handleProviderAccountsRequest(req, new URL(req.url), authFor(user.id, user.name));
    expect(res?.status).toBe(200);
    const body = await res!.json();
    expect(body.accounts).toHaveLength(2);
    expect(body.accounts.map((a: { provider: string }) => a.provider).sort()).toEqual(["claude", "codex"]);
    for (const account of body.accounts) {
      expect(account).toHaveProperty("accountStatus");
      expect(account).toHaveProperty("hasApiKey");
      expect(account).toHaveProperty("authVia");
      expect(account).toHaveProperty("hostHints");
      expect(JSON.stringify(account)).not.toMatch(/sk-/i);
      expect(account).not.toHaveProperty("anthropicApiKey");
      expect(account).not.toHaveProperty("openaiApiKey");
    }
  });

  test("refresh re-probes status", async () => {
    const user = claimUserByName(`Conn Refresh ${crypto.randomUUID()}`);
    const req = request("/api/me/provider-accounts/refresh", { method: "POST" });
    const res = await handleProviderAccountsRequest(req, new URL(req.url), authFor(user.id, user.name));
    expect(res?.status).toBe(200);
    const body = await res!.json();
    expect(body.accounts).toHaveLength(2);
  });

  test("stores API keys in managed env without echoing secrets", async () => {
    const user = claimUserByName(`Conn Keys ${crypto.randomUUID()}`);
    const secret = `sk-ant-test-${crypto.randomUUID()}`;
    const req = request("/api/me/provider-accounts/keys", {
      method: "PUT",
      body: JSON.stringify({ anthropicApiKey: secret }),
    });
    const res = await handleProviderAccountsRequest(req, new URL(req.url), authFor(user.id, user.name));
    expect(res?.status).toBe(200);
    const body = await res!.json();
    expect(body.updated).toEqual(["ANTHROPIC_API_KEY"]);
    expect(JSON.stringify(body)).not.toContain(secret);
    expect(body.accounts.find((a: { provider: string }) => a.provider === "claude").hasApiKey).toBe(true);
    expect(readManagedUserEnv(user.id).ANTHROPIC_API_KEY).toBe(secret);
  });

  test("rejects empty key update body", async () => {
    const user = claimUserByName(`Conn Empty ${crypto.randomUUID()}`);
    const req = request("/api/me/provider-accounts/keys", {
      method: "PUT",
      body: JSON.stringify({}),
    });
    const res = await handleProviderAccountsRequest(req, new URL(req.url), authFor(user.id, user.name));
    expect(res?.status).toBe(400);
    expect(await res?.json()).toEqual({ error: "provide anthropicApiKey and/or openaiApiKey" });
  });
});
