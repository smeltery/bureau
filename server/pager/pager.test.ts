import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, rmSync, statSync } from "fs";
import type { AuthResult } from "../auth/auth-middleware.ts";
import { agents } from "../agents/state.ts";
import { _testResetAgentTokens, mintAgentToken } from "../agents/tokens.ts";
import * as AgentManager from "../agent-manager.ts";
import { installAgent } from "../http/__tests__/privileged-agent-fixture.ts";
import { claimUserByName, deleteUserById, updateUserById } from "../users.ts";
import { discordPayload, isDue, pagerTick } from "./delivery.ts";
import { _testResetPagerRoutes, handlePagerRequest, pagerDeliveryDeps } from "./routes.ts";
import { _testResetPagerSettings, getDiscordWebhook, PAGER_WEBHOOKS_FILE, updatePagerSettings } from "./settings.ts";
import { _testResetPagerStore, ackPage, PAGER_DIR, pruneResolvedPages, raisePage, resolvePage, RESOLVED_RETENTION_MS } from "./store.ts";

const WEBHOOK = "https://discord.com/api/webhooks/123456/abc-DEF_9";
const posts: { url: string; payload: { content: string; allowed_mentions: { users: string[] } } }[] = [];
const realPost = pagerDeliveryDeps.post;
const userIds: string[] = [];

function reset() {
  rmSync(PAGER_DIR, { recursive: true, force: true });
  _testResetPagerStore();
  _testResetPagerSettings();
  _testResetPagerRoutes();
  _testResetAgentTokens();
  agents.clear();
  posts.length = 0;
  for (const id of userIds.splice(0)) deleteUserById(id);
}

beforeEach(() => {
  reset();
  pagerDeliveryDeps.post = async (url, payload) => {
    posts.push({ url, payload: payload as (typeof posts)[number]["payload"] });
    return { status: 204 };
  };
});
afterEach(() => {
  reset();
  pagerDeliveryDeps.post = realPost;
});

function member(name: string, role: "owner" | "member" = "member") {
  const user = claimUserByName(`${name} ${crypto.randomUUID()}`, { role });
  userIds.push(user.id);
  return user;
}

function session(userId: string, username = "u"): AuthResult {
  return { kind: "ok", session: { sessionIdHash: "h", sessionPrefix: "p", userId, username, role: "member", needsRolling: false, absoluteExpiresAt: Date.now() + 60_000 } };
}

async function call(path: string, init: RequestInit & { auth?: AuthResult; token?: string } = {}) {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (init.token) headers.Authorization = `Bearer ${init.token}`;
  const req = new Request(`http://local.test${path}`, { ...init, headers });
  const res = await handlePagerRequest(req, new URL(req.url), init.auth);
  return { status: res!.status, body: (await res!.json()) as Record<string, any> };
}

describe("pager store", () => {
  const source = { kind: "agent" as const, id: "a1", name: "Ada", roomId: null };

  test("a raise with the key of an unresolved page updates it instead of opening another", () => {
    const first = raisePage({ source, targetUserId: "u1", title: "Disk full", key: "disk", now: 1 });
    ackPage(first.entry.id, "boss", 2);
    const again = raisePage({ source, targetUserId: "u1", title: "Disk still full", body: "98%", key: "disk", now: 3 });
    expect(again.created).toBe(false);
    expect(again.entry).toMatchObject({ id: first.entry.id, raiseCount: 2, title: "Disk still full", body: "98%", state: "acked", lastRaisedAt: 3 });

    resolvePage(first.entry.id, "Ada", 4);
    expect(raisePage({ source, targetUserId: "u1", title: "Disk full again", key: "disk", now: 5 }).created).toBe(true);
  });

  test("resolved pages are deleted after the retention window", () => {
    const { entry } = raisePage({ source, targetUserId: "u1", title: "x", now: 1 });
    resolvePage(entry.id, "Ada", 10);
    expect(pruneResolvedPages(10 + RESOLVED_RETENTION_MS - 1)).toBe(0);
    expect(pruneResolvedPages(10 + RESOLVED_RETENTION_MS + 1)).toBe(1);
  });
});

describe("pager settings and delivery", () => {
  test("keeps the webhook URL in an owner-only file and validates it", () => {
    expect(updatePagerSettings("u1", { webhookUrl: "https://example.com/hook" })).toMatchObject({ ok: false });
    expect(updatePagerSettings("u1", { webhookUrl: WEBHOOK, discordUserId: "123456789", repeatMinutes: 10 })).toEqual({
      ok: true,
      settings: { discordUserId: "123456789", repeatMinutes: 10, webhookConfigured: true },
    });
    expect(statSync(PAGER_WEBHOOKS_FILE).mode & 0o777).toBe(0o600);
    _testResetPagerSettings();
    expect(getDiscordWebhook("u1")).toBe(WEBHOOK);
  });

  test("mentions only the member, links to the page, and repeats open pages on the interval", async () => {
    updatePagerSettings("u1", { webhookUrl: WEBHOOK, discordUserId: "42424242", repeatMinutes: 5 });
    const { entry } = raisePage({ source: { kind: "app", id: "health", name: "health", roomId: null }, targetUserId: "u1", title: "Site down", now: 0 });
    const payload = discordPayload(entry, "page", { origin: () => "https://office.example/", roomName: () => null }, "42424242") as { content: string; allowed_mentions: unknown };
    expect(payload.content).toContain("<@42424242> Page: **Site down**");
    expect(payload.content).toContain("https://office.example/pager?page=" + entry.id);
    expect(payload.allowed_mentions).toEqual({ parse: [], users: ["42424242"] });

    let now = 0;
    const deps = { ...pagerDeliveryDeps, now: () => now, changed: () => {} };
    await pagerTick(deps);
    now = 4 * 60_000;
    await pagerTick(deps);
    now = 5 * 60_000;
    await pagerTick(deps);
    expect(posts).toHaveLength(2);
    ackPage(entry.id, "boss");
    now = 20 * 60_000;
    expect(isDue({ ...entry, state: "acked" }, now)).toBe(false);
  });
});

describe("pager routes", () => {
  test("an agent pages its manager, re-raises by key, and resolves; the manager sees and acks", async () => {
    const manager = member("Manager");
    const roomId = AgentManager.getRooms()[0]!.id;
    updateUserById(manager.id, { allowedRooms: [roomId] });
    updatePagerSettings(manager.id, { webhookUrl: WEBHOOK });
    installAgent("pager-agent", 0, manager.id);
    const token = mintAgentToken("pager-agent", manager.id);

    const raised = await call("/api/pager", { method: "POST", token, body: JSON.stringify({ title: "Deploy blocked", key: "deploy" }) });
    expect(raised.status).toBe(201);
    expect(raised.body.page).toMatchObject({ targetUserId: manager.id, source: { kind: "agent", id: "pager-agent", roomId }, delivery: { sends: 1, failure: null } });
    const again = await call("/api/pager", { method: "POST", token, body: JSON.stringify({ title: "Deploy still blocked", key: "deploy" }) });
    expect(again).toMatchObject({ status: 200, body: { created: false, page: { raiseCount: 2 } } });

    const listed = await call("/api/pager", { auth: session(manager.id) });
    expect(listed.body.pages.map((p: { id: string }) => p.id)).toEqual([raised.body.page.id]);
    const outsider = member("Outsider");
    expect((await call("/api/pager", { auth: session(outsider.id) })).body.pages).toEqual([]);

    expect((await call(`/api/pager/${raised.body.page.id}/ack`, { method: "POST", auth: session(manager.id) })).body.page.state).toBe("acked");
    const resolved = await call("/api/pager/resolve", { method: "POST", token, body: JSON.stringify({ key: "deploy" }) });
    expect(resolved.body.page).toMatchObject({ state: "resolved", resolvedBy: "Agent pager-agent" });
    expect(posts.at(-1)!.payload.content).toStartWith("Resolved: **Deploy still blocked**");
  });

  test("refuses raises without a source token or a title", async () => {
    expect((await call("/api/pager", { method: "POST", body: JSON.stringify({ title: "x" }) })).status).toBe(401);
    expect((await call("/api/pager", { auth: { kind: "loopback" } })).status).toBe(401);
    const manager = member("Manager");
    installAgent("pager-agent", 0, manager.id);
    const token = mintAgentToken("pager-agent", manager.id);
    expect((await call("/api/pager", { method: "POST", token, body: JSON.stringify({ body: "no title" }) })).status).toBe(400);
  });

  test("a page to a member with no webhook stays in the view, marked undelivered, and sends once one is added", async () => {
    const manager = member("Manager");
    installAgent("pager-agent", 0, manager.id);
    const token = mintAgentToken("pager-agent", manager.id);
    const raised = await call("/api/pager", { method: "POST", token, body: JSON.stringify({ title: "Help" }) });
    expect(raised.body.page.delivery).toMatchObject({ sends: 0, failure: "no_webhook" });
    expect(posts).toHaveLength(0);

    await call("/api/pager/settings", { method: "PUT", auth: session(manager.id), body: JSON.stringify({ webhookUrl: WEBHOOK }) });
    await pagerTick(pagerDeliveryDeps);
    expect(posts).toHaveLength(1);
    expect(existsSync(PAGER_WEBHOOKS_FILE)).toBe(true);
  });
});
