// What a PRIVILEGED agent token must NEVER do. Every handler below is reached
// with a valid privileged bearer token and no browser session; each must refuse.
//
// The dependency stubs throw on call, so a gate that ever started honoring a
// bearer token here fails loudly instead of quietly returning 200.
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import * as AgentManager from "../../agent-manager.ts";
import type { AuthResult } from "../../auth/auth-middleware.ts";
import { handleAccessRequest } from "../access.ts";
import { handleAgentsRequest } from "../agents.ts";
import { handleInvitesRequest } from "../invites.ts";
import { handleOfficeSettingsRequest } from "../office-settings.ts";
import { handleCronjobsRequest } from "../cronjobs.ts";
import { handleSessionsRequest } from "../sessions.ts";
import { handleUsersRequest } from "../users.ts";
import { handleViewRequest } from "../view.ts";
import { bearerRequest, OPERATOR_AGENT, setupPrivilegedFixture, TARGET_AGENT, teardownPrivilegedFixture, type PrivilegedFixture } from "./privileged-agent-fixture.ts";

const noSession: AuthResult = { kind: "loopback" };

function refuse(): never {
  throw new Error("a privileged agent token must never reach this dependency");
}

let fixture: PrivilegedFixture;

beforeEach(() => {
  fixture = setupPrivilegedFixture();
});

afterEach(() => {
  teardownPrivilegedFixture(fixture);
});

describe("privileged agent — office-wide settings stay out of reach", () => {
  test("refuses office settings reads and writes", async () => {
    const read = bearerRequest("/api/office/settings", fixture.privilegedToken, { method: "GET" });
    const write = bearerRequest("/api/office/settings", fixture.privilegedToken, { method: "PUT", body: JSON.stringify({ prompt: "Agent-written office prompt", envFile: null }) });

    const readRes = await handleOfficeSettingsRequest(read, new URL(read.url), noSession);
    const writeRes = await handleOfficeSettingsRequest(write, new URL(write.url), noSession);

    expect(readRes?.status).toBe(401);
    expect(writeRes?.status).toBe(401);
    expect(AgentManager.getOfficeSettings().prompt).not.toBe("Agent-written office prompt");
  });

  test("refuses the external-access switch", async () => {
    const req = bearerRequest("/api/office/access", fixture.privilegedToken, {
      method: "PUT",
      body: JSON.stringify({ externalAccess: true, publicOrigin: "https://evil.test", previewAllowHosts: [] }),
    });

    const res = await handleAccessRequest(req, new URL(req.url), noSession, { get: refuse, set: refuse });

    expect(res?.status).toBe(401);
    expect(await res?.json()).toEqual({ error: "authenticated browser session required" });
  });
});

describe("privileged agent — human account surfaces stay out of reach", () => {
  test("refuses invite minting", async () => {
    const req = bearerRequest("/api/invites", fixture.privilegedToken, { body: JSON.stringify({ username: "Smuggled Owner", role: "owner" }) });

    const res = await handleInvitesRequest(req, new URL(req.url), noSession, { list: refuse, mint: refuse, mintSelf: refuse, mintRecovery: refuse, revoke: refuse });

    expect(res?.status).toBe(401);
    expect(await res?.json()).toEqual({ error: "unauthenticated" });
  });

  test("refuses browser-session revocation", async () => {
    const req = bearerRequest("/api/sessions/abcdef", fixture.privilegedToken, { method: "DELETE" });

    const res = await handleSessionsRequest(req, new URL(req.url), noSession, { list: refuse, revoke: refuse, logout: refuse });

    expect(res?.status).toBe(401);
    expect(await res?.json()).toEqual({ error: "unauthenticated" });
  });

  test("refuses user record edits, including the room access it is scoped by", async () => {
    const rename = bearerRequest(`/api/users/${encodeURIComponent(fixture.manager.name)}`, fixture.privilegedToken, { method: "PATCH", body: JSON.stringify({ name: "Renamed Boss" }) });
    const widen = bearerRequest(`/api/users/${encodeURIComponent(fixture.manager.name)}/access`, fixture.privilegedToken, {
      method: "PUT",
      body: JSON.stringify({ allowedRooms: [fixture.visibleRoomId, fixture.hiddenRoomId] }),
    });
    const deps = { update: refuse, setAccess: refuse, delete: refuse };

    const renameRes = await handleUsersRequest(rename, new URL(rename.url), noSession, deps);
    const widenRes = await handleUsersRequest(widen, new URL(widen.url), noSession, deps);

    expect(renameRes?.status).toBe(401);
    expect(widenRes?.status).toBe(401);
    expect(fixture.manager.allowedRooms).toEqual([fixture.visibleRoomId]);
  });

  test("refuses per-user view preferences", async () => {
    const req = bearerRequest("/api/me/view/order", fixture.privilegedToken, { method: "PUT", body: JSON.stringify({ order: [fixture.visibleRoomId] }) });

    const res = await handleViewRequest(req, new URL(req.url), noSession, {
      applyView: refuse,
      listAccessibleRooms: () => null,
    });

    expect(res?.status).toBe(401);
    expect(await res?.json()).toEqual({ error: "unauthenticated" });
  });
});

describe("privileged agent — no path flips a privilege flag", () => {
  test("cannot grant privilege to itself or to a peer over HTTP", async () => {
    for (const target of [OPERATOR_AGENT, TARGET_AGENT]) {
      for (const auth of [undefined, noSession] as (AuthResult | undefined)[]) {
        const req = bearerRequest(`/api/agents/${target}/privileged`, fixture.privilegedToken, { method: "PUT", body: JSON.stringify({ privileged: true }) });

        const res = await handleAgentsRequest(req, new URL(req.url), auth);

        expect(res?.status).not.toBe(200);
        expect(AgentManager.getAgent(target)?.privileged ?? false).toBe(false);
      }
    }
  });

  test("cannot revoke privilege either — the toggle is not an agent-writable field", async () => {
    const req = bearerRequest(`/api/agents/${OPERATOR_AGENT}/privileged`, fixture.privilegedToken, { method: "PUT", body: JSON.stringify({ privileged: false }) });

    const res = await handleAgentsRequest(req, new URL(req.url), undefined);

    expect(res?.status).toBe(401);
    expect(await res?.json()).toEqual({ error: "unauthenticated" });
  });

  test("cannot smuggle the flag through the agent edit route it IS allowed to use", async () => {
    const req = bearerRequest(`/api/agents/${TARGET_AGENT}`, fixture.privilegedToken, { method: "PATCH", body: JSON.stringify({ privileged: true, name: "Edited By Operator" }) });

    const res = await handleAgentsRequest(req, new URL(req.url), undefined);

    expect(res?.status).toBe(200);
    expect(AgentManager.getAgent(TARGET_AGENT)?.name).toBe("Edited By Operator");
    expect(AgentManager.getAgent(TARGET_AGENT)?.privileged ?? false).toBe(false);
  });
});

describe("privileged agent — office-wide schedule prompt stays out of reach", () => {
  test("refuses PUT /api/cron-prompt", async () => {
    const req = bearerRequest("/api/cron-prompt", fixture.privilegedToken, {
      method: "PUT",
      body: JSON.stringify({ value: "Agent-written cron prompt" }),
    });
    const res = await handleCronjobsRequest(req, new URL(req.url), noSession);
    expect(res?.status).toBe(401);
    expect(await res?.json()).toEqual({ error: "authenticated browser session required" });
  });
});
