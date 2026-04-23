const JSON_HEADERS = { "Content-Type": "application/json" };

const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000;
const RATE_LIMIT_MINUTE_MS = 60_000;
const RATE_LIMIT_PER_MINUTE = 5;
const RATE_LIMIT_PER_WINDOW = 20;

// In-memory limiter (resets on cold start)
const hits = new Map<string, number[]>();

export function rateLimit(ip: string): { allowed: boolean; retryAfterSeconds?: number } {
  const now = Date.now();
  const timestamps = (hits.get(ip) || []).filter((t) => now - t < RATE_LIMIT_WINDOW_MS);

  const lastMinute = timestamps.filter((t) => now - t < RATE_LIMIT_MINUTE_MS);
  if (lastMinute.length >= RATE_LIMIT_PER_MINUTE) return { allowed: false, retryAfterSeconds: 60 };
  if (timestamps.length >= RATE_LIMIT_PER_WINDOW) {
    return {
      allowed: false,
      retryAfterSeconds: Math.ceil((timestamps[0] + RATE_LIMIT_WINDOW_MS - now) / 1000),
    };
  }

  timestamps.push(now);
  hits.set(ip, timestamps);
  return { allowed: true };
}

export function createRateLimitResponse(retryAfterSeconds: number): Response {
  return new Response(
    JSON.stringify({ error: `Rate limit exceeded. Try again in ${retryAfterSeconds} seconds.` }),
    { status: 429, headers: JSON_HEADERS }
  );
}
