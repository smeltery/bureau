import { existsSync, mkdirSync, readFileSync } from "fs";
import { dirname, join } from "path";
import type { PagerEntry } from "../../shared/types.ts";
import { atomicWriteFileSync, BUREAU_DIR } from "../persistence/paths.ts";
import { createPagerArchive } from "./history/archive.ts";

export const PAGER_DIR = join(BUREAU_DIR, "pager");
export const PAGES_FILE = join(PAGER_DIR, "pages.json");
export const PAGE_TITLE_MAX = 200;
export const PAGE_BODY_MAX = 2000;
export const PAGE_KEY_MAX = 200;
export const pagerArchive = createPagerArchive(join(PAGER_DIR, "resolved"));

let pages: PagerEntry[] | null = null;

function persist(next: PagerEntry[]): void {
  mkdirSync(dirname(PAGES_FILE), { recursive: true });
  atomicWriteFileSync(PAGES_FILE, JSON.stringify(next, null, 2));
}

function cleanActiveFile(next: PagerEntry[]): void {
  try {
    persist(next);
  } catch (error) {
    // Resolution already committed in the archive. A retry/restart reconciles
    // stale active rows; do not report that the committed resolution failed.
    console.error("[pager] failed to clean archived rows from active storage:", error);
  }
}

function load(): PagerEntry[] {
  if (pages) return pages;
  const parsed = existsSync(PAGES_FILE) ? JSON.parse(readFileSync(PAGES_FILE, "utf-8")) : [];
  if (!Array.isArray(parsed)) throw new Error("Invalid Pager active storage");
  const active: PagerEntry[] = [];
  for (const page of parsed as PagerEntry[]) {
    if (pagerArchive.read(page.id)) continue;
    if (page.state === "resolved") pagerArchive.save(page);
    else active.push(page);
  }
  pages = active;
  if (active.length !== parsed.length) cleanActiveFile(active);
  return pages;
}

/** Active pages only. Resolved incident history is read in bounded windows. */
export function listPages(): readonly PagerEntry[] {
  return load();
}

export function findPage(id: string): PagerEntry | undefined {
  const active = load();
  return pagerArchive.read(id) ?? active.find((page) => page.id === id);
}

export function findUnresolvedByKey(source: PagerEntry["source"], key: string): PagerEntry | undefined {
  return load().find((page) => page.key === key && page.source.kind === source.kind && page.source.id === source.id);
}

function updateActive(page: PagerEntry, changes: Partial<PagerEntry>): PagerEntry {
  const next = { ...page, ...changes };
  persist(load().map((entry) => (entry.id === page.id ? next : entry)));
  Object.assign(page, next);
  return page;
}

export interface RaiseInput {
  source: PagerEntry["source"];
  targetUserId: string;
  title: string;
  body?: string;
  key?: string;
  now?: number;
}

/** A re-raise refreshes text/count but never re-opens an acknowledged page. */
export function raisePage(input: RaiseInput): { entry: PagerEntry; created: boolean } {
  const now = input.now ?? Date.now();
  const existing = input.key ? findUnresolvedByKey(input.source, input.key) : undefined;
  if (existing) {
    const entry = updateActive(existing, { lastRaisedAt: now, raiseCount: existing.raiseCount + 1, title: input.title, body: input.body });
    if (input.body === undefined) delete entry.body;
    return { entry, created: false };
  }
  const list = load();
  const entry: PagerEntry = {
    id: crypto.randomUUID(),
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
  persist([entry, ...list]);
  list.unshift(entry);
  return { entry, created: true };
}

export function ackPage(id: string, by: string, now = Date.now()): PagerEntry | null {
  const page = findPage(id);
  return page?.state === "open" ? updateActive(page, { state: "acked", ackedAt: now, ackedBy: by }) : null;
}

export function resolvePage(id: string, by: string, now = Date.now()): PagerEntry | null {
  const page = findPage(id);
  if (!page || page.state === "resolved") return null;
  const resolved: PagerEntry = { ...page, state: "resolved", resolvedAt: now, resolvedBy: by };
  pagerArchive.save(resolved);
  Object.assign(page, resolved);
  pages = load().filter((entry) => entry.id !== id);
  cleanActiveFile(pages);
  return page;
}

export function recordDelivery(id: string, delivery: PagerEntry["delivery"]): void {
  const page = findPage(id);
  if (!page) return;
  if (page.state === "resolved") pagerArchive.save({ ...page, delivery });
  else updateActive(page, { delivery });
}

export function _testResetPagerStore(): void {
  pages = null;
}
