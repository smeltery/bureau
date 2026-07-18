const WINDOW_MS = 60_000;
const INVITE_PEEK_LIMIT = 10;
const INVITE_ACCEPT_LIMIT = 5;

type AuthRateLimitAction = "invite_peek" | "invite_accept";

interface Bucket {
  windowStart: number;
  count: number;
}

const buckets = new Map<string, Bucket>();

export function checkAuthRateLimit(req: Request, action: AuthRateLimitAction, now = Date.now()): Response | null {
  const limit = action === "invite_peek" ? INVITE_PEEK_LIMIT : INVITE_ACCEPT_LIMIT;
  const key = `${action}:${clientKey(req)}`;
  const existing = buckets.get(key);
  if (!existing || now - existing.windowStart >= WINDOW_MS) {
    buckets.set(key, { windowStart: now, count: 1 });
    return null;
  }
  existing.count += 1;
  if (existing.count <= limit) return null;
  const retryAfterSeconds = Math.max(1, Math.ceil((WINDOW_MS - (now - existing.windowStart)) / 1000));
  return new Response("too many attempts", {
    status: 429,
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Retry-After": String(retryAfterSeconds),
    },
  });
}

function clientKey(req: Request): string {
  const forwarded = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return req.headers.get("cf-connecting-ip")?.trim() || req.headers.get("fly-client-ip")?.trim() || req.headers.get("x-real-ip")?.trim() || forwarded || "unknown";
}

export function _testResetAuthRateLimits(): void {
  buckets.clear();
}
