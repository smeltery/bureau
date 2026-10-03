import { describe, expect, test } from "bun:test";
import type { AuthResult } from "../../auth/auth-middleware.ts";
import * as AgentManager from "../../agent-manager.ts";
import { writeManagedUserEnv } from "../../persistence/managed-env.ts";
import { claimUserByName } from "../../users.ts";
import { handleEnvSettingsRequest, handleOfficeSettingsRequest } from "../office-settings.ts";

const ownerAuth: AuthResult = {
  kind: "ok",
  session: {
    sessionIdHash: "hash",
    sessionPrefix: "sess",
    userId: "owner-1",
    username: "Owner",
    role: "owner",
    needsRolling: false,
    absoluteExpiresAt: Date.now() + 86_400_000,
  },
};

const memberAuth: AuthResult = {
  kind: "ok",
  session: {
    sessionIdHash: "hash",
    sessionPrefix: "sess",
    userId: "member-1",
    username: "Member",
    role: "member",
    needsRolling: false,
    absoluteExpiresAt: Date.now() + 86_400_000,
  },
};

function request(path: string, init: RequestInit = {}): Request {
  return new Request(`http://local.test${path}`, {
    ...init,
    headers: {
      ...(init.body ? { "Content-Type": "application/json" } : {}),
      ...init.headers,
    },
  });
}

describe("handleOfficeSettingsRequest", () => {
  test("returns null for unrelated /api routes", async () => {
    const req = request("/api/rooms");

    await expect(handleOfficeSettingsRequest(req, new URL(req.url), ownerAuth)).resolves.toBeNull();
  });

  test("requires a browser session for office settings routes", async () => {
    const req = request("/api/office/settings");

    const res = await handleOfficeSettingsRequest(req, new URL(req.url), { kind: "loopback" });

    expect(res?.status).toBe(401);
    expect(await res?.json()).toEqual({ error: "authenticated browser session required" });
  });

  test("requires owner access for office settings routes", async () => {
    const req = request("/api/office/settings");

    const res = await handleOfficeSettingsRequest(req, new URL(req.url), memberAuth);

    expect(res?.status).toBe(403);
    expect(await res?.json()).toEqual({ error: "owner access required" });
  });

  test("returns office settings to owners", async () => {
    const req = request("/api/office/settings");

    const res = await handleOfficeSettingsRequest(req, new URL(req.url), ownerAuth);

    expect(res?.status).toBe(200);
    const body = await res?.json();
    expect(body).toHaveProperty("prompt");
    expect(body).toHaveProperty("envFile");
    expect(typeof body.prompt === "string" || body.prompt === null).toBe(true);
    expect(typeof body.envFile === "string" || body.envFile === null).toBe(true);
    expect(typeof body.version).toBe("string");
    expect(body.version).toMatch(/^[0-9a-f]{12}$/);
    expect(body.experimental).toEqual({ browserPanel: expect.any(Boolean) });
    expect(body.memberUsageCap).toEqual(expect.any(Boolean));
    expect(body.memberUsageShare).toEqual(expect.any(Number));
  });

  test("persists member usage cap settings through PUT", async () => {
    const current = await handleOfficeSettingsRequest(request("/api/office/settings"), new URL("http://local.test/api/office/settings"), ownerAuth);
    const body = (await current!.json()) as {
      version: string;
      prompt: string | null;
      envFile: string | null;
      experimental: { browserPanel: boolean };
      memberUsageCap: boolean;
      memberUsageShare: number;
    };
    const put = await handleOfficeSettingsRequest(
      request("/api/office/settings", {
        method: "PUT",
        body: JSON.stringify({ prompt: body.prompt, envFile: body.envFile, version: body.version, experimental: body.experimental, memberUsageCap: true, memberUsageShare: 70 }),
      }),
      new URL("http://local.test/api/office/settings"),
      ownerAuth,
    );
    expect(put?.status).toBe(204);
    expect(AgentManager.getOfficeSettings().memberUsageCap).toBe(true);
    expect(AgentManager.getOfficeSettings().memberUsageShare).toBe(70);
    await handleOfficeSettingsRequest(
      request("/api/office/settings", {
        method: "PUT",
        body: JSON.stringify({
          prompt: body.prompt,
          envFile: body.envFile,
          version: AgentManager.officeSettingsVersion(AgentManager.getOfficeSettings()),
          experimental: body.experimental,
          memberUsageCap: body.memberUsageCap,
          memberUsageShare: body.memberUsageShare,
        }),
      }),
      new URL("http://local.test/api/office/settings"),
      ownerAuth,
    );
  });

  test("persists experimental.browserPanel through PUT", async () => {
    const currentReq = request("/api/office/settings");
    const current = await handleOfficeSettingsRequest(currentReq, new URL(currentReq.url), ownerAuth);
    const body = (await current!.json()) as { version: string; prompt: string | null; envFile: string | null; experimental: { browserPanel: boolean } };

    const put = await handleOfficeSettingsRequest(
      request("/api/office/settings", {
        method: "PUT",
        body: JSON.stringify({
          prompt: body.prompt,
          envFile: body.envFile,
          version: body.version,
          experimental: { browserPanel: !body.experimental.browserPanel },
        }),
      }),
      new URL("http://local.test/api/office/settings"),
      ownerAuth,
    );
    expect(put?.status).toBe(204);
    expect(AgentManager.getOfficeSettings().experimental.browserPanel).toBe(!body.experimental.browserPanel);

    // Restore prior value so other tests stay isolated.
    const again = await handleOfficeSettingsRequest(request("/api/office/settings"), new URL("http://local.test/api/office/settings"), ownerAuth);
    const restoredVersion = ((await again!.json()) as { version: string }).version;
    await handleOfficeSettingsRequest(
      request("/api/office/settings", {
        method: "PUT",
        body: JSON.stringify({
          prompt: body.prompt,
          envFile: body.envFile,
          version: restoredVersion,
          experimental: body.experimental,
        }),
      }),
      new URL("http://local.test/api/office/settings"),
      ownerAuth,
    );
  });

  test("persists receptionistAgentId through PUT", async () => {
    const currentReq = request("/api/office/settings");
    const current = await handleOfficeSettingsRequest(currentReq, new URL(currentReq.url), ownerAuth);
    const body = (await current!.json()) as {
      version: string;
      prompt: string | null;
      envFile: string | null;
      experimental: { browserPanel: boolean };
      receptionistAgentId: string | null;
    };

    const put = await handleOfficeSettingsRequest(
      request("/api/office/settings", {
        method: "PUT",
        body: JSON.stringify({
          prompt: body.prompt,
          envFile: body.envFile,
          version: body.version,
          experimental: body.experimental,
          receptionistAgentId: "agent-recep-1",
        }),
      }),
      new URL("http://local.test/api/office/settings"),
      ownerAuth,
    );
    expect(put?.status).toBe(204);
    expect(AgentManager.getOfficeSettings().receptionistAgentId).toBe("agent-recep-1");

    const again = await handleOfficeSettingsRequest(request("/api/office/settings"), new URL("http://local.test/api/office/settings"), ownerAuth);
    const restoredVersion = ((await again!.json()) as { version: string }).version;
    await handleOfficeSettingsRequest(
      request("/api/office/settings", {
        method: "PUT",
        body: JSON.stringify({
          prompt: body.prompt,
          envFile: body.envFile,
          version: restoredVersion,
          experimental: body.experimental,
          receptionistAgentId: null,
        }),
      }),
      new URL("http://local.test/api/office/settings"),
      ownerAuth,
    );
    expect(AgentManager.getOfficeSettings().receptionistAgentId).toBeNull();
  });

  test("rejects invalid JSON before saving settings", async () => {
    const req = request("/api/office/settings", {
      method: "PUT",
      body: "not json",
    });

    const res = await handleOfficeSettingsRequest(req, new URL(req.url), ownerAuth);

    expect(res?.status).toBe(400);
    expect(await res?.json()).toEqual({ error: "invalid JSON" });
  });

  test("requires the current office settings version when saving", async () => {
    const currentReq = request("/api/office/settings");
    const current = await handleOfficeSettingsRequest(currentReq, new URL(currentReq.url), ownerAuth);
    const version = ((await current!.json()) as { version: string }).version;

    const missing = await handleOfficeSettingsRequest(
      request("/api/office/settings", {
        method: "PUT",
        body: JSON.stringify({ prompt: "no version", envFile: null }),
      }),
      new URL("http://local.test/api/office/settings"),
      ownerAuth,
    );
    expect(missing?.status).toBe(400);
    expect(await missing?.json()).toEqual({ error: "settings version is required" });

    AgentManager.setOfficeSettings("writer-b", null);

    const stale = await handleOfficeSettingsRequest(
      request("/api/office/settings", {
        method: "PUT",
        body: JSON.stringify({ prompt: "stale write", envFile: null, version }),
      }),
      new URL("http://local.test/api/office/settings"),
      ownerAuth,
    );
    expect(stale?.status).toBe(409);
    const staleBody = (await stale?.json()) as { error: string; version: string };
    expect(staleBody.error).toBe("office settings changed; fetch the latest version and retry");
    expect(staleBody.version).toBe(AgentManager.officeSettingsVersion());
    expect(AgentManager.getOfficeSettings().prompt).toBe("writer-b");

    const latestReq = request("/api/office/settings");
    const latest = await handleOfficeSettingsRequest(latestReq, new URL(latestReq.url), ownerAuth);
    const latestVersion = ((await latest!.json()) as { version: string }).version;

    const ok = await handleOfficeSettingsRequest(
      request("/api/office/settings", {
        method: "PUT",
        body: JSON.stringify({ prompt: "saved", envFile: null, version: latestVersion }),
      }),
      new URL("http://local.test/api/office/settings"),
      ownerAuth,
    );
    expect(ok?.status).toBe(204);
    expect(AgentManager.getOfficeSettings().prompt).toBe("saved");
  });

  test("stale version wins over invalid env path (re-read before field errors)", async () => {
    const currentReq = request("/api/office/settings");
    const current = await handleOfficeSettingsRequest(currentReq, new URL(currentReq.url), ownerAuth);
    const staleVersion = ((await current!.json()) as { version: string }).version;
    AgentManager.setOfficeSettings("after-b", null);

    const res = await handleOfficeSettingsRequest(
      request("/api/office/settings", {
        method: "PUT",
        body: JSON.stringify({ prompt: "x", envFile: "/no/such/env/file.env", version: staleVersion }),
      }),
      new URL("http://local.test/api/office/settings"),
      ownerAuth,
    );
    expect(res?.status).toBe(409);
    expect(AgentManager.getOfficeSettings().prompt).toBe("after-b");
  });
});

describe("handleEnvSettingsRequest", () => {
  test("returns null for unrelated routes", async () => {
    const req = request("/api/users/Member");

    await expect(handleEnvSettingsRequest(req, new URL(req.url), ownerAuth)).resolves.toBeNull();
  });

  test("requires owner access for office env", async () => {
    const req = request("/api/office/env");

    const res = await handleEnvSettingsRequest(req, new URL(req.url), memberAuth);

    expect(res?.status).toBe(403);
    expect(await res?.json()).toEqual({ error: "owner access required" });
  });

  test("rejects malformed value maps", async () => {
    const req = request("/api/office/env", { method: "PUT", body: JSON.stringify({ values: { OK: 1 } }) });

    const res = await handleEnvSettingsRequest(req, new URL(req.url), ownerAuth);

    expect(res?.status).toBe(400);
    expect(await res?.json()).toEqual({ error: "values must be a string map" });
  });

  test("lets owners inspect only member variable names", async () => {
    const member = claimUserByName(`Member Env Names ${crypto.randomUUID()}`, { role: "member" });
    writeManagedUserEnv(member.id, { BETA_KEY: "hidden", ALPHA_KEY: "also-hidden" });
    const req = request(`/api/users/${encodeURIComponent(member.name)}/env/names`);

    const res = await handleEnvSettingsRequest(req, new URL(req.url), ownerAuth);

    expect(res?.status).toBe(200);
    expect(await res?.json()).toEqual({ names: ["ALPHA_KEY", "BETA_KEY"] });
  });

  test("keeps member variable names owner-only", async () => {
    const member = claimUserByName(`Member Env Names Gate ${crypto.randomUUID()}`, { role: "member" });
    const req = request(`/api/users/${encodeURIComponent(member.name)}/env/names`);

    const res = await handleEnvSettingsRequest(req, new URL(req.url), memberAuth);

    expect(res?.status).toBe(403);
    expect(await res?.json()).toEqual({ error: "owner access required" });
  });
});
