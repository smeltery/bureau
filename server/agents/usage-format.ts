// Pure formatting helpers and bucket math for the /usage report. Kept
// side-effect free so tests can import them without bringing in the agents
// state machine (which loads office config from disk on import). The full
// `usage.ts` re-exports these from this module.

// `cacheRead` is discounted cache hits; `cacheCreation` is the 1.25x write
// tier. Raw `input_tokens` (uncached) is usually ~10 — just the new user
// message — so "cached as a % of totalIn" is always ~100% and meaningless.
// The useful signal is hit-rate over *cacheable* input: cacheRead / (cacheRead
// + cacheCreation), which drops when the cache expires and gets rewritten.
export interface UsageBucket {
  totalIn: number;
  cacheRead: number;
  cacheCreation: number;
  totalOut: number;
  costUSD: number;
}

export function emptyBucket(): UsageBucket {
  return { totalIn: 0, cacheRead: 0, cacheCreation: 0, totalOut: 0, costUSD: 0 };
}

export function addBucket(dst: UsageBucket, src: UsageBucket) {
  dst.totalIn += src.totalIn;
  dst.cacheRead += src.cacheRead;
  dst.cacheCreation += src.cacheCreation;
  dst.totalOut += src.totalOut;
  dst.costUSD += src.costUSD;
}

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

export function formatRelativeTime(timestamp: number, now: number = Date.now()): string {
  const diffMs = now - timestamp;
  const diffSec = Math.floor(diffMs / 1000);
  const diffMin = Math.floor(diffSec / 60);
  const diffHr = Math.floor(diffMin / 60);
  const diffDays = Math.floor(diffHr / 24);

  if (diffSec < 60) return "just now";
  if (diffMin < 60) return `${diffMin}m ago`;
  if (diffHr < 24) return `${diffHr}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  const date = new Date(timestamp);
  return date.toLocaleDateString([], { month: "short", day: "numeric" });
}

export function formatTokenCount(n: number): string {
  if (n === 0) return "—";
  // 999_500 rounds to "1000k" under naive thresholds; promote to M.
  if (n >= 999_500) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}k`;
  return n.toLocaleString();
}

// Hide the (N% hit) suffix above 80% since typical usage hovers 92-100% and the
// clutter drowns out the signal. Showing only low hit rates turns absence into
// the default and presence into a cache-thrash canary.
const CACHE_HIT_WARN_THRESHOLD = 80;

export function formatInCell(b: UsageBucket): string {
  if (b.totalIn === 0) return "—";
  const cacheable = b.cacheRead + b.cacheCreation;
  if (cacheable === 0) return formatTokenCount(b.totalIn);
  const pct = Math.round((b.cacheRead / cacheable) * 100);
  if (pct >= CACHE_HIT_WARN_THRESHOLD) return formatTokenCount(b.totalIn);
  return `${formatTokenCount(b.totalIn)} (${pct}% hit)`;
}

export function formatUsd(n: number): string {
  if (n === 0) return "—";
  if (n >= 100) return `$${n.toFixed(0)}`;
  return `$${n.toFixed(2)}`;
}
