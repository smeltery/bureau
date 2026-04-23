// Shared time formatters and escalation color thresholds.
// Deduplicates helpers that previously lived in LogView, LogEntryCard,
// TaskView, and StatusLight.

export const ESCALATION_AMBER_MS = 2 * 60 * 1000; // 2 minutes
export const ESCALATION_RED_MS = 5 * 60 * 1000; // 5 minutes

/** "12s", "1:23", etc. Integer seconds only. Used by header/activity elapsed displays. */
export function formatElapsed(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  if (totalSec < 60) return `${totalSec}s`;
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  return `${min}:${sec.toString().padStart(2, "0")}`;
}

/** "1.2s", "1:23" etc. Fractional seconds. Used for tool call duration badges. */
export function formatDuration(ms: number): string {
  const totalSec = ms / 1000;
  if (totalSec < 60) return `${totalSec.toFixed(1)}s`;
  const min = Math.floor(totalSec / 60);
  const sec = Math.floor(totalSec % 60);
  return `${min}:${sec.toString().padStart(2, "0")}`;
}

/** "just now", "5m ago", "2h ago", "3d ago". Used for task list + session list. */
export function timeAgo(ts: number): string {
  const diff = Date.now() - ts;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

/**
 * Escalate a base color to amber (after 2m) or red (after 5m). The activity
 * indicator and status light both use this to nudge the boss when an agent
 * has been running for too long.
 */
export function escalationColor(elapsedMs: number, baseColor: string): string {
  if (elapsedMs >= ESCALATION_RED_MS) return "var(--red)";
  if (elapsedMs >= ESCALATION_AMBER_MS) return "var(--orange)";
  return baseColor;
}
