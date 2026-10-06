import type { PagerDeliveryFailure, PagerEntry } from "../../shared/types.ts";
import { getDiscordWebhook, getPagerSettings } from "./settings.ts";
import { listPages, pruneResolvedPages, recordDelivery } from "./store.ts";

export type DiscordPost = (url: string, payload: object) => Promise<{ status: number; retryAfterMs?: number }>;

export interface PagerDeliveryDeps {
  post: DiscordPost;
  origin: () => string;
  roomName: (roomId: string | null) => string | null;
  now: () => number;
  changed: () => void;
}

const TICK_MS = 30_000;
const DISCORD_CONTENT_MAX = 2000;

export const postToDiscord: DiscordPost = async (url, payload) => {
  const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload), signal: AbortSignal.timeout(10_000) });
  let retryAfterMs: number | undefined;
  if (res.status === 429) {
    const body = (await res.json().catch(() => null)) as { retry_after?: number } | null;
    const seconds = typeof body?.retry_after === "number" ? body.retry_after : Number(res.headers.get("Retry-After"));
    if (Number.isFinite(seconds) && seconds > 0) retryAfterMs = Math.ceil(seconds * 1000);
  }
  return { status: res.status, retryAfterMs };
};

export function pageLink(origin: string, id: string): string {
  return `${origin.replace(/\/+$/, "")}/pager?page=${encodeURIComponent(id)}`;
}

export function discordPayload(page: PagerEntry, kind: "page" | "resolved" | "test", deps: Pick<PagerDeliveryDeps, "origin" | "roomName">, discordUserId: string): object {
  const room = deps.roomName(page.source.roomId);
  const from = `${page.source.name}${room ? ` in ${room}` : ""}`;
  const mention = discordUserId ? `<@${discordUserId}> ` : "";
  const lines =
    kind === "resolved"
      ? [`Resolved: **${page.title}**`, `From ${from}`]
      : [
          `${mention}${kind === "test" ? "Test page" : "Page"}: **${page.title}**`,
          ...(page.body ? [page.body] : []),
          `From ${from}${page.raiseCount > 1 ? ` · raised ${page.raiseCount} times` : ""}`,
          pageLink(deps.origin(), page.id),
        ];
  return {
    content: lines.join("\n").slice(0, DISCORD_CONTENT_MAX),
    allowed_mentions: { parse: [], users: kind !== "resolved" && discordUserId ? [discordUserId] : [] },
  };
}

function failureFor(status: number): PagerDeliveryFailure | null {
  if (status >= 200 && status < 300) return null;
  if (status === 429) return "rate_limited";
  return status >= 500 ? "http_5xx" : "http_4xx";
}

/** Send one Discord message for a page. Records the outcome on the page unless it is a test. */
export async function sendPage(page: PagerEntry, kind: "page" | "resolved" | "test", deps: PagerDeliveryDeps): Promise<PagerDeliveryFailure | null> {
  const now = deps.now();
  const url = getDiscordWebhook(page.targetUserId);
  let failure: PagerDeliveryFailure | null = null;
  let retryAfter: number | undefined;
  if (!url) failure = "no_webhook";
  else {
    try {
      const result = await deps.post(url, discordPayload(page, kind, deps, getPagerSettings(page.targetUserId).discordUserId));
      failure = failureFor(result.status);
      if (result.retryAfterMs !== undefined) retryAfter = now + result.retryAfterMs;
    } catch {
      failure = "network";
    }
  }
  if (kind === "page") {
    const sends = page.delivery.sends + (failure === null ? 1 : 0);
    recordDelivery(page.id, { lastAttemptAt: now, sends, failure, ...(retryAfter !== undefined ? { retryAfter } : {}) });
    deps.changed();
  }
  return failure;
}

export function isDue(page: PagerEntry, now: number): boolean {
  if (page.state !== "open") return false;
  const { lastAttemptAt, failure, retryAfter } = page.delivery;
  if (retryAfter !== undefined && now < retryAfter) return false;
  if (lastAttemptAt === null) return true;
  // A member with no webhook keeps the page in the view; nothing to retry
  // until they add one, and adding one re-sends their open pages.
  if (failure === "no_webhook") return false;
  const repeatMinutes = getPagerSettings(page.targetUserId).repeatMinutes;
  if (failure !== null) return now - lastAttemptAt >= Math.min(repeatMinutes ?? 1, 1) * 60_000;
  return repeatMinutes !== null && now - lastAttemptAt >= repeatMinutes * 60_000;
}

export async function pagerTick(deps: PagerDeliveryDeps): Promise<void> {
  const now = deps.now();
  if (pruneResolvedPages(now) > 0) deps.changed();
  for (const page of listPages().filter((p) => isDue(p, now))) await sendPage(page, "page", deps);
}

let timer: ReturnType<typeof setInterval> | null = null;

export function startPagerDelivery(deps: PagerDeliveryDeps): void {
  if (timer) return;
  timer = setInterval(() => {
    pagerTick(deps).catch((err: unknown) => console.error("[pager] delivery tick failed:", err instanceof Error ? err.message : err));
  }, TICK_MS);
  timer.unref?.();
}
