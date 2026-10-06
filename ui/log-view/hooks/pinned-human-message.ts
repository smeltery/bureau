import { isApiTokenDevice } from "../../../shared/identity.ts";
import type { LogEntry } from "../../../shared/types.ts";

export type VerticalRect = { top: number; bottom: number };

/** True when a user_message should count as a human composer turn for pin context. */
export function senderIsHuman(metadata: Record<string, unknown> | undefined): boolean {
  if (metadata?.sender_webhook_name || metadata?.sender_agent_name || metadata?.sender_app_name || metadata?.sender_cronjob_name) return false;
  // Personal API tokens carry human authority but arrive from a script, not the
  // composer — same treatment as agent/app/cron senders for the pin banner.
  return !isApiTokenDevice(metadata?.device as string | undefined);
}

/**
 * Most recent human user_message scrolled fully above the viewport, or null if
 * any human message is currently visible (or none exist). Agent / app / cron /
 * API-token user_messages are skipped so the banner keeps human ask context.
 */
export function pinnedHumanMessageId(logs: readonly LogEntry[], rectForId: (id: string) => VerticalRect | undefined, viewport: VerticalRect): string | null {
  for (let i = logs.length - 1; i >= 0; i--) {
    const entry = logs[i]!;
    if (entry.kind !== "user_message" || !senderIsHuman(entry.metadata)) continue;
    const rect = rectForId(entry.id);
    if (!rect) continue;
    if (rect.bottom > viewport.top && rect.top < viewport.bottom) return null;
    if (rect.bottom <= viewport.top) return entry.id;
  }
  return null;
}
