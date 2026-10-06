/**
 * Pager HTTP surface.
 *
 * Raising: an agent (bearer token) or an app (app token) pages the person
 * responsible for it, POST /api/pager or POST /api/app/page. The token decides
 * the source and the target; the body only carries the words and an optional
 * dedupe key. Sources can resolve their own pages by id or key.
 *
 * Reading and acting: members list the pages they can see, ack and resolve
 * them, and manage their own Discord delivery settings.
 */

import type { PagerEntry, UserRecord } from "../../shared/types.ts";
import * as AgentManager from "../agent-manager.ts";
import { readBearerToken, resolveAgentToken } from "../agents/tokens.ts";
import { appRegistry } from "../apps/registry.ts";
import { resolveAppToken } from "../apps/tokens.ts";
import type { AuthResult } from "../auth/auth-middleware.ts";
import { getPublicOrigin } from "../public-origin.ts";
import { canSeeRoom, getUserById } from "../users.ts";
import { broadcast } from "../ws/broadcast.ts";
import { postToDiscord, sendPage, type PagerDeliveryDeps } from "./delivery.ts";
import { getPagerSettings, updatePagerSettings } from "./settings.ts";
import { ackPage, findPage, findUnresolvedByKey, listPages, PAGE_BODY_MAX, PAGE_KEY_MAX, PAGE_TITLE_MAX, raisePage, recordDelivery, resolvePage } from "./store.ts";

const JSON_HEADERS = { "Access-Control-Allow-Origin": "*", "Content-Type": "application/json" };
const NEW_PAGES_PER_HOUR = 20;
const recentRaises = new Map<string, number[]>();

export const pagerDeliveryDeps: PagerDeliveryDeps = {
  post: postToDiscord,
  origin: getPublicOrigin,
  roomName: (roomId) => (roomId ? (AgentManager.getRooms().find((room) => room.id === roomId)?.name ?? null) : null),
  now: Date.now,
  changed: () => broadcast({ type: "pager_changed" }),
};

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

async function readBody(req: Request): Promise<Record<string, unknown> | null> {
  try {
    const body = await req.json();
    return body && typeof body === "object" && !Array.isArray(body) ? (body as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

type Source = PagerEntry["source"] & { targetUserId: string | null };

function agentSource(req: Request): Source | null {
  const identity = resolveAgentToken(readBearerToken(req));
  const agent = identity ? AgentManager.getAgent(identity.agentId) : undefined;
  if (!identity || !agent) return null;
  return { kind: "agent", id: agent.id, name: agent.name, roomId: AgentManager.getRooms()[agent.room]?.id ?? null, targetUserId: agent.userId ?? null };
}

function appSource(req: Request): Source | null {
  const raw = readBearerToken(req);
  const identity = raw ? resolveAppToken(raw) : null;
  const record = identity ? appRegistry.get(identity.appName) : undefined;
  if (!identity || !record) return null;
  const builder = record.createdByAgentId ? AgentManager.getAgent(record.createdByAgentId) : undefined;
  const roomId = builder ? (AgentManager.getRooms()[builder.room]?.id ?? null) : null;
  return { kind: "app", id: record.name, name: record.name, roomId, targetUserId: record.userId };
}

function text(value: unknown, max: number): string | undefined | null {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || value.trim() === "" || value.length > max) return null;
  return value.trim();
}

function underRaiseLimit(source: Source, now: number): boolean {
  const key = `${source.kind}:${source.id}`;
  const recent = (recentRaises.get(key) ?? []).filter((at) => at > now - 3_600_000);
  if (recent.length >= NEW_PAGES_PER_HOUR) return false;
  recent.push(now);
  recentRaises.set(key, recent);
  return true;
}

async function raiseFrom(req: Request, source: Source | null): Promise<Response> {
  if (!source) return json(401, { error: "a valid agent or app token is required" });
  if (!source.targetUserId) return json(409, { error: "nobody is responsible for this source, so there is nobody to page" });
  const body = await readBody(req);
  const title = text(body?.title, PAGE_TITLE_MAX);
  const pageBody = text(body?.body, PAGE_BODY_MAX);
  const key = text(body?.key, PAGE_KEY_MAX);
  if (!title) return json(400, { error: `title is required (at most ${PAGE_TITLE_MAX} characters)` });
  if (pageBody === null) return json(400, { error: `body must be text of at most ${PAGE_BODY_MAX} characters` });
  if (key === null) return json(400, { error: `key must be text of at most ${PAGE_KEY_MAX} characters` });
  const { targetUserId, ...pageSource } = source;
  const reraise = key ? findUnresolvedByKey(pageSource, key) : undefined;
  if (!reraise && !underRaiseLimit(source, Date.now())) return json(429, { error: `at most ${NEW_PAGES_PER_HOUR} new pages an hour` });
  const { entry, created } = raisePage({ source: pageSource, targetUserId, title, body: pageBody, key });
  pagerDeliveryDeps.changed();
  if (created) await sendPage(entry, "page", pagerDeliveryDeps);
  return json(created ? 201 : 200, { page: findPage(entry.id), created });
}

async function resolveFrom(req: Request, source: Source | null): Promise<Response> {
  if (!source) return json(401, { error: "a valid agent or app token is required" });
  const body = await readBody(req);
  const page = typeof body?.id === "string" ? findPage(body.id) : typeof body?.key === "string" ? findUnresolvedByKey(source, body.key) : undefined;
  if (!page || page.source.kind !== source.kind || page.source.id !== source.id) return json(404, { error: "no unresolved page from you with that id or key" });
  return finishResolve(page.id, source.name);
}

async function finishResolve(id: string, by: string): Promise<Response> {
  const resolved = resolvePage(id, by);
  if (!resolved) return json(409, { error: "page is already resolved" });
  pagerDeliveryDeps.changed();
  if (resolved.delivery.sends > 0) await sendPage(resolved, "resolved", pagerDeliveryDeps);
  return json(200, { page: resolved });
}

function memberFor(auth: AuthResult | undefined): UserRecord | null {
  const userId = auth?.kind === "ok" ? auth.session.userId : auth?.kind === "api" ? auth.token.userId : null;
  return userId ? getUserById(userId) : null;
}

export function canSeePage(user: UserRecord, page: PagerEntry): boolean {
  if (page.targetUserId === user.id) return true;
  return page.source.roomId ? canSeeRoom(user, page.source.roomId) : user.role === "owner";
}

export async function handlePagerRequest(req: Request, url: URL, auth: AuthResult | undefined): Promise<Response | null> {
  if (url.pathname === "/api/app/page" && req.method === "POST") return raiseFrom(req, appSource(req));
  if (url.pathname === "/api/app/page/resolve" && req.method === "POST") return resolveFrom(req, appSource(req));
  if (url.pathname !== "/api/pager" && !url.pathname.startsWith("/api/pager/")) return null;

  const parts = url.pathname.split("/").slice(3);
  if (req.method === "POST" && parts.length === 0) return raiseFrom(req, agentSource(req));
  if (req.method === "POST" && parts[0] === "resolve" && parts.length === 1) return resolveFrom(req, agentSource(req));

  if (parts[0] === "settings") {
    if (auth?.kind !== "ok") return json(401, { error: "signed-in session required" });
    const userId = auth.session.userId;
    if (req.method === "GET" && parts.length === 1) return json(200, { settings: getPagerSettings(userId) });
    if (req.method === "PUT" && parts.length === 1) {
      const result = updatePagerSettings(userId, (await readBody(req)) ?? {});
      if (!result.ok) return json(422, { error: result.error });
      if (result.settings.webhookConfigured) {
        for (const page of listPages()) {
          if (page.targetUserId === userId && page.state === "open" && page.delivery.failure === "no_webhook") recordDelivery(page.id, { ...page.delivery, lastAttemptAt: null, failure: null });
        }
      }
      return json(200, { settings: result.settings });
    }
    if (req.method === "POST" && parts[1] === "test" && parts.length === 2) {
      const now = Date.now();
      const sample: PagerEntry = {
        id: "test",
        createdAt: now,
        lastRaisedAt: now,
        raiseCount: 1,
        source: { kind: "agent", id: "test", name: "Bureau", roomId: null },
        targetUserId: userId,
        title: "Your pager works",
        body: "Pages from your agents and apps will arrive here.",
        state: "open",
        delivery: { lastAttemptAt: null, sends: 0, failure: null },
      };
      const failure = await sendPage(sample, "test", pagerDeliveryDeps);
      return json(failure ? 502 : 200, { ok: !failure, failure });
    }
    return json(404, { error: "not found" });
  }

  const user = memberFor(auth);
  if (!user) return json(401, { error: "signed-in member required" });
  if (req.method === "GET" && parts.length === 0) {
    const pages = listPages().filter((page) => canSeePage(user, page));
    return json(200, { pages });
  }
  const page = parts.length === 2 ? findPage(parts[0]!) : undefined;
  if (!page || !canSeePage(user, page)) return json(404, { error: "page not found" });
  if (req.method === "POST" && parts[1] === "ack") {
    const acked = ackPage(page.id, user.name);
    if (!acked) return json(409, { error: "only an open page can be acked" });
    pagerDeliveryDeps.changed();
    return json(200, { page: acked });
  }
  if (req.method === "POST" && parts[1] === "resolve") return finishResolve(page.id, user.name);
  return json(404, { error: "not found" });
}

export function _testResetPagerRoutes(): void {
  recentRaises.clear();
}
