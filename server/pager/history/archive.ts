import { existsSync, mkdirSync, readFileSync, statSync } from "node:fs";
import { opendir } from "node:fs/promises";
import { join } from "node:path";
import type { PagerEntry } from "../../../shared/types.ts";
import { atomicWriteFileSync } from "../../persistence/paths.ts";

const VALID_ID = /^[a-zA-Z0-9_-]{1,100}$/;
const MAX_RECORD_BYTES = 256 * 1024;
type Position = { at: number; id: string };
const position = (page: PagerEntry): Position => ({ at: page.resolvedAt ?? page.lastRaisedAt, id: page.id });
const compare = (a: Position, b: Position) => b.at - a.at || b.id.localeCompare(a.id);

export function parseHistoryCursor(cursor: string | null): Position | null {
  if (!cursor) return null;
  try {
    if (cursor.length > 256) throw new Error();
    const value = JSON.parse(Buffer.from(cursor, "base64url").toString());
    if (!Number.isSafeInteger(value?.at) || value.at < 0 || typeof value.id !== "string" || !VALID_ID.test(value.id)) throw new Error();
    return value;
  } catch {
    throw new Error("invalid history cursor");
  }
}

/** One atomic file per resolved incident: bounded reads and direct old-link lookup.
 * The archive record is authoritative if a crash leaves its old active row behind. */
export function createPagerArchive(directory: string, write = atomicWriteFileSync) {
  function read(id: string): PagerEntry | undefined {
    if (!VALID_ID.test(id)) return undefined;
    const path = join(directory, `${id}.json`);
    try {
      if (statSync(path).size > MAX_RECORD_BYTES) throw new Error("Pager history record exceeds its size limit");
      const page = JSON.parse(readFileSync(path, "utf8")) as PagerEntry;
      if (page.id !== id || page.state !== "resolved") throw new Error("Invalid Pager history record");
      return page;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
      throw error;
    }
  }

  function save(page: PagerEntry): void {
    if (!VALID_ID.test(page.id) || page.state !== "resolved") throw new Error("Only resolved pages can be archived");
    const data = JSON.stringify(page);
    if (Buffer.byteLength(data) > MAX_RECORD_BYTES) throw new Error("Pager history record exceeds its size limit");
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    write(join(directory, `${page.id}.json`), data);
  }

  async function list({ visible, limit = 50, cursor = null }: { visible: (page: PagerEntry) => boolean; limit?: number; cursor?: string | null }) {
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new Error("history limit must be between 1 and 100");
    const before = parseHistoryCursor(cursor);
    const selected: PagerEntry[] = [];
    if (!existsSync(directory)) return { pages: selected, nextCursor: null };
    let dir;
    try {
      dir = await opendir(directory);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return { pages: selected, nextCursor: null };
      throw error;
    }
    // Scan incrementally and retain only one authorized window. Neither the
    // number of archive files nor hidden incidents grows the in-memory result.
    for await (const entry of dir) {
      if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
      const page = read(entry.name.slice(0, -5));
      if (!page || !visible(page) || (before && compare(position(page), before) <= 0)) continue;
      selected.push(page);
      selected.sort((a, b) => compare(position(a), position(b)));
      if (selected.length > limit + 1) selected.pop();
    }
    const hasMore = selected.length > limit;
    if (hasMore) selected.pop();
    return { pages: selected, nextCursor: hasMore ? Buffer.from(JSON.stringify(position(selected.at(-1)!))).toString("base64url") : null };
  }
  return { read, save, list };
}
