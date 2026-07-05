import { describe, expect, test } from "bun:test";
import type { AuthResult } from "../../auth/auth-middleware.ts";
import { handleCronjobsRequest } from "../cronjobs.ts";

const ownerAuth: AuthResult = {
  kind: "ok",
  session: {
    sessionIdHash: "hash",
    sessionPrefix: "sess",
    userId: "owner-1",
    username: "Owner",
    role: "owner",
    needsRolling: false,
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
  },
};

describe("handleCronjobsRequest", () => {
  test("accepts /api/cronjobs as an alias for cronjob reads", async () => {
    const req = new Request("http://local.test/api/cronjobs");

    const res = await handleCronjobsRequest(req, new URL(req.url));

    expect(res?.status).toBe(200);
    expect(await res?.json()).toEqual([]);
  });

  test("returns aggregate runs from /api/cron-runs", async () => {
    const req = new Request("http://local.test/api/cron-runs");

    const res = await handleCronjobsRequest(req, new URL(req.url));

    expect(res?.status).toBe(200);
    expect(await res?.json()).toEqual({ jobs: [] });
  });

  test("routes /api cron run affordances through the cron handler", async () => {
    const req = new Request("http://local.test/api/cronjobs/cron-1/runs/run-1/diff", {
      method: "POST",
      body: JSON.stringify({}),
    });

    const res = await handleCronjobsRequest(req, new URL(req.url));

    expect(res?.status).toBe(404);
    expect(await res?.json()).toEqual({ error: "not found" });
  });

  test("requires owner access for cron prompt updates", async () => {
    const req = new Request("http://local.test/api/cron-prompt", {
      method: "PUT",
      body: JSON.stringify({ value: "Run quietly" }),
    });

    const res = await handleCronjobsRequest(req, new URL(req.url), memberAuth);

    expect(res?.status).toBe(403);
    expect(await res?.json()).toEqual({ error: "owner access required" });
  });

  test("updates the cron prompt", async () => {
    const req = new Request("http://local.test/api/cron-prompt", {
      method: "PUT",
      body: JSON.stringify({ value: "Run quietly" }),
    });

    const res = await handleCronjobsRequest(req, new URL(req.url), ownerAuth);

    expect(res?.status).toBe(204);

    const cleanup = new Request("http://local.test/api/cron-prompt", {
      method: "PUT",
      body: JSON.stringify({ value: null }),
    });
    await handleCronjobsRequest(cleanup, new URL(cleanup.url), ownerAuth);
  });
});
