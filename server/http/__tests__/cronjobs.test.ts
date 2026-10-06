import { describe, expect, test } from "bun:test";
import type { AuthResult } from "../../auth/auth-middleware.ts";
import * as CronjobManager from "../../cronjobs/index.ts";
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

  test("creates, updates, and deletes cronjobs over the api", async () => {
    const createReq = new Request("http://local.test/api/cronjobs", {
      method: "POST",
      body: JSON.stringify({
        name: "Daily check",
        schedule: { type: "daily", hour: 9, minute: 0 },
        prompt: "Check the queue",
        cwd: process.cwd(),
        agentType: "codex",
        modelFamily: "gpt-5",
        effort: "medium",
        permissionMode: "never",
        codexSandbox: "workspace-write",
      }),
    });

    const createdRes = await handleCronjobsRequest(createReq, new URL(createReq.url), ownerAuth);
    const created = await createdRes?.json();

    expect(createdRes?.status).toBe(201);
    expect(created.name).toBe("Daily check");

    const updateReq = new Request(`http://local.test/api/cronjobs/${created.id}`, {
      method: "PATCH",
      body: JSON.stringify({ enabled: false }),
    });
    const updatedRes = await handleCronjobsRequest(updateReq, new URL(updateReq.url), ownerAuth);
    const updated = await updatedRes?.json();

    expect(updatedRes?.status).toBe(200);
    expect(updated.enabled).toBe(false);

    const engineUpdateReq = new Request(`http://local.test/api/cronjobs/${created.id}`, {
      method: "PATCH",
      body: JSON.stringify({
        agentType: "claude",
        modelFamily: "opus",
        effort: "high",
        permissionMode: "bypassPermissions",
      }),
    });
    const engineUpdatedRes = await handleCronjobsRequest(engineUpdateReq, new URL(engineUpdateReq.url), ownerAuth);
    const engineUpdated = await engineUpdatedRes?.json();

    expect(engineUpdatedRes?.status).toBe(200);
    expect(engineUpdated.agentType).toBe("claude");
    expect(engineUpdated.modelFamily).toBe("opus");
    expect(engineUpdated.effort).toBe("high");
    expect(engineUpdated.permissionMode).toBe("bypassPermissions");
    expect(engineUpdated.codexSandbox).toBeUndefined();

    const deleteReq = new Request(`http://local.test/api/cronjobs/${created.id}`, { method: "DELETE" });
    const deletedRes = await handleCronjobsRequest(deleteReq, new URL(deleteReq.url), ownerAuth);

    expect(deletedRes?.status).toBe(204);
  });

  test("rejects malformed cronjob schedules before persistence", async () => {
    const createReq = new Request("http://local.test/api/cronjobs", {
      method: "POST",
      body: JSON.stringify({
        name: "Bad schedule",
        schedule: { type: "daily", hour: "9", minute: 0 },
        prompt: "Check the queue",
        cwd: process.cwd(),
        modelFamily: "opus",
        effort: "high",
        permissionMode: "bypassPermissions",
      }),
    });

    const res = await handleCronjobsRequest(createReq, new URL(createReq.url), ownerAuth);

    expect(res?.status).toBe(400);
    expect(await res?.json()).toEqual({ error: "schedule must be manual, daily, weekly, or interval with finite numeric fields" });
  });

  test("rejects malformed cronjob update schedules", async () => {
    const cronjob = CronjobManager.addCronjob({
      name: "Update schedule",
      schedule: { type: "daily", hour: 9, minute: 0 },
      prompt: "Check",
      cwd: process.cwd(),
      agentType: "claude",
      modelFamily: "opus",
      effort: "high",
      permissionMode: "bypassPermissions",
      username: "Owner",
      userId: "owner-1",
    });
    const req = new Request(`http://local.test/api/cronjobs/${cronjob.id}`, {
      method: "PATCH",
      body: JSON.stringify({ schedule: { type: "interval", minutes: null } }),
    });

    const res = await handleCronjobsRequest(req, new URL(req.url), ownerAuth);

    expect(res?.status).toBe(400);
    expect(await res?.json()).toEqual({ error: "schedule must be manual, daily, weekly, or interval with finite numeric fields" });

    CronjobManager.deleteCronjob(cronjob.id);
  });

  test("rejects malformed cronjob update agent types", async () => {
    const cronjob = CronjobManager.addCronjob({
      name: "Update engine",
      schedule: { type: "daily", hour: 9, minute: 0 },
      prompt: "Check",
      cwd: process.cwd(),
      agentType: "claude",
      modelFamily: "opus",
      effort: "high",
      permissionMode: "bypassPermissions",
      username: "Owner",
      userId: "owner-1",
    });
    const req = new Request(`http://local.test/api/cronjobs/${cronjob.id}`, {
      method: "PATCH",
      body: JSON.stringify({ agentType: "bogus" }),
    });

    const res = await handleCronjobsRequest(req, new URL(req.url), ownerAuth);

    expect(res?.status).toBe(400);
    expect(await res?.json()).toEqual({ error: "agentType must be claude, codex, or opencode" });

    CronjobManager.deleteCronjob(cronjob.id);
  });

  test("rejects Claude-shaped Codex cron models with 422 before persist", async () => {
    const cronjob = CronjobManager.addCronjob({
      name: "Codex shape",
      schedule: { type: "daily", hour: 9, minute: 0 },
      prompt: "Check",
      cwd: process.cwd(),
      agentType: "codex",
      modelFamily: "gpt-7-x",
      effort: "medium",
      permissionMode: "never",
      username: "Owner",
      userId: "owner-1",
    });
    const req = new Request(`http://local.test/api/cronjobs/${cronjob.id}`, {
      method: "PATCH",
      body: JSON.stringify({ modelFamily: "fable-5" }),
    });

    const res = await handleCronjobsRequest(req, new URL(req.url), ownerAuth);

    expect(res?.status).toBe(422);
    expect(await res?.json()).toEqual({ error: '"fable-5" is not a Codex model.' });
    expect(CronjobManager.listCronjobs().find((j) => j.id === cronjob.id)?.modelFamily).toBe("gpt-7-x");

    CronjobManager.deleteCronjob(cronjob.id);
  });

  test("rejects create with a Claude family on Codex with 422", async () => {
    const createReq = new Request("http://local.test/api/cronjobs", {
      method: "POST",
      body: JSON.stringify({
        name: "Bad Codex",
        schedule: { type: "daily", hour: 9, minute: 0 },
        prompt: "Check the queue",
        cwd: process.cwd(),
        agentType: "codex",
        modelFamily: "opus",
        effort: "medium",
        permissionMode: "never",
      }),
    });

    const res = await handleCronjobsRequest(createReq, new URL(createReq.url), ownerAuth);

    expect(res?.status).toBe(422);
    expect(await res?.json()).toEqual({ error: '"opus" is not a Codex model.' });
    expect(CronjobManager.listCronjobs().some((j) => j.name === "Bad Codex")).toBe(false);
  });

  test("requires owner or creator access for cronjob mutations", async () => {
    const cronjob = CronjobManager.addCronjob({
      name: "Member owned",
      schedule: { type: "daily", hour: 9, minute: 0 },
      prompt: "Check",
      cwd: process.cwd(),
      agentType: "codex",
      modelFamily: "gpt-5",
      effort: "medium",
      permissionMode: "never",
      codexSandbox: "workspace-write",
      username: "Other",
      userId: "other-user",
    });

    const req = new Request(`http://local.test/api/cronjobs/${cronjob.id}`, {
      method: "PATCH",
      body: JSON.stringify({ enabled: false }),
    });

    const res = await handleCronjobsRequest(req, new URL(req.url), memberAuth);

    expect(res?.status).toBe(404);
    expect(await res?.json()).toEqual({ error: "not found" });

    CronjobManager.deleteCronjob(cronjob.id);
  });

  test("returns not found for missing cron run message routes", async () => {
    const req = new Request("http://local.test/api/cronjobs/cron-1/runs/missing/messages", {
      method: "POST",
      body: JSON.stringify({ text: "Follow up" }),
    });

    const res = await handleCronjobsRequest(req, new URL(req.url), ownerAuth);

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
