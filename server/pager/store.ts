import { existsSync, mkdirSync, readFileSync } from "fs";
import { dirname, join } from "path";
import type { PagerEntry } from "../../shared/types.ts";
import { generateHexId } from "../../shared/types.ts";
import { atomicWriteFileSync, BUREAU_DIR } from "../persistence/paths.ts";

export const PAGER_DIR = join(BUREAU_DIR, "pager");
export const PAGES_FILE = join(PAGER_DIR, "pages.json");
export const RESOLVED_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
export const PAGE_TITLE_MAX = 200;
export const PAGE_BODY_MAX = 2000;
export const PAGE_KEY_MAX = 200;

let pages: PagerEntry[] | null = null;

function load(): PagerEntry[] {
  if (pages) return pages;
  try {
    const parsed = existsSync(PAGES_FILE) ? JSON.parse(readFileSync(PAGES_FILE, "utf-8")) : [];
    pages = Array.isArray(parsed) ? (parsed as PagerEntry[]) : [];
  } catch {
    pages = [];
  }
  return pages;
}

function persist(): void {
  mkdirSync(dirname(PAGES_FILE), { recursive: true });
  atomicWriteFileSync(PAGES_FILE, JSON.stringify(load(), null, 2));
}

export function listPages(): readonly PagerEntry[] {
  return load();
}

export function findPage(id: string): PagerEntry | undefined {
  return load().find((page) => page.id === id);
}

export function findUnresolvedByKey(source: PagerEntry["source"], key: string): PagerEntry | undefined {
  return load().find((page) => page.state !== "resolved" && page.key === key && page.source.kind === source.kind && page.source.id === source.id);
}

export interface RaiseInput {
  source: PagerEntry["source"];
  targetUserId: string;
  title: string;
  body?: string;
  key?: string;
  now?: number;
}

/** Raise a page, or re-raise the source's unresolved page with the same key.
 * A re-raise refreshes the text and count but never re-opens an acked page. */
export function raisePage(input: RaiseInput): { entry: PagerEntry; created: boolean } {
  const now = input.now ?? Date.now();
  const existing = input.key ? findUnresolvedByKey(input.source, input.key) : undefined;
  if (existing) {
    existing.lastRaisedAt = now;
    existing.raiseCount += 1;
    existing.title = input.title;
    if (input.body === undefined) delete existing.body;
    else existing.body = input.body;
    persist();
    return { entry: existing, created: false };
  }
  const list = load();
  const id = generateHexId(list.map((page) => page.id));
  const entry: PagerEntry = {
    id,
    createdAt: now,
    lastRaisedAt: now,
    raiseCount: 1,
    source: input.source,
    targetUserId: input.targetUserId,
    title: input.title,
    ...(input.body !== undefined ? { body: input.body } : {}),
    ...(input.key !== undefined ? { key: input.key } : {}),
    state: "open",
    delivery: { lastAttemptAt: null, sends: 0, failure: null },
  };
  list.unshift(entry);
  persist();
  return { entry, created: true };
}

export function ackPage(id: string, by: string, now = Date.now()): PagerEntry | null {
  const page = findPage(id);
  if (!page || page.state !== "open") return null;
  page.state = "acked";
  page.ackedAt = now;
  page.ackedBy = by;
  persist();
  return page;
}

export function resolvePage(id: string, by: string, now = Date.now()): PagerEntry | null {
  const page = findPage(id);
  if (!page || page.state === "resolved") return null;
  page.state = "resolved";
  page.resolvedAt = now;
  page.resolvedBy = by;
  persist();
  return page;
}

export function recordDelivery(id: string, delivery: PagerEntry["delivery"]): void {
  const page = findPage(id);
  if (!page) return;
  page.delivery = delivery;
  persist();
}

/** Drop resolved pages older than the retention window. Returns how many went. */
export function pruneResolvedPages(now = Date.now()): number {
  const list = load();
  const kept = list.filter((page) => page.state !== "resolved" || (page.resolvedAt ?? 0) > now - RESOLVED_RETENTION_MS);
  const removed = list.length - kept.length;
  if (removed > 0) {
    pages = kept;
    persist();
  }
  return removed;
}

export function _testResetPagerStore(): void {
  pages = null;
}
