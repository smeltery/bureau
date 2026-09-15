import type { JsonRpcLiteClient } from "./client.ts";

export interface RawTurn {
  id: string;
  items: unknown[];
}

const THREAD_HISTORY_PAGE_LIMIT = 100;
const THREAD_HISTORY_PAGE_CAP = 1_000;

export async function readThreadTurns(client: Pick<JsonRpcLiteClient, "request">, threadId: string): Promise<RawTurn[]> {
  const turns: RawTurn[] = [];
  const byId = new Map<string, RawTurn>();
  let cursor: string | null = null;
  const seenTurnCursors = new Set<string>();
  for (let page = 0; page < THREAD_HISTORY_PAGE_CAP; page += 1) {
    const resp: { data?: unknown[]; nextCursor?: string | null } = await client.request<{ data?: unknown[]; nextCursor?: string | null }>("thread/turns/list", {
      threadId,
      cursor,
      limit: THREAD_HISTORY_PAGE_LIMIT,
      sortDirection: "asc",
      itemsView: "notLoaded",
    });
    for (const raw of resp.data ?? []) {
      const id = (raw as { id?: unknown })?.id;
      if (typeof id !== "string" || byId.has(id)) continue;
      const turn = { id, items: [] };
      turns.push(turn);
      byId.set(id, turn);
    }
    const next: string | null = resp.nextCursor ?? null;
    if (!next) break;
    if (seenTurnCursors.has(next)) throw new Error("thread/turns/list returned a repeated cursor");
    seenTurnCursors.add(next);
    cursor = next;
    if (page === THREAD_HISTORY_PAGE_CAP - 1) throw new Error("thread/turns/list exceeded the page cap");
  }

  cursor = null;
  const seenItemCursors = new Set<string>();
  for (let page = 0; page < THREAD_HISTORY_PAGE_CAP; page += 1) {
    const resp: { data?: Array<{ turnId?: unknown; item?: unknown }>; nextCursor?: string | null } = await client.request<{
      data?: Array<{ turnId?: unknown; item?: unknown }>;
      nextCursor?: string | null;
    }>("thread/items/list", {
      threadId,
      cursor,
      limit: THREAD_HISTORY_PAGE_LIMIT,
      sortDirection: "asc",
    });
    for (const entry of resp.data ?? []) {
      if (typeof entry.turnId === "string" && entry.item !== undefined) byId.get(entry.turnId)?.items.push(entry.item);
    }
    const next: string | null = resp.nextCursor ?? null;
    if (!next) break;
    if (seenItemCursors.has(next)) throw new Error("thread/items/list returned a repeated cursor");
    seenItemCursors.add(next);
    cursor = next;
    if (page === THREAD_HISTORY_PAGE_CAP - 1) throw new Error("thread/items/list exceeded the page cap");
  }
  return turns;
}

export function findTurnIndexContainingItemId(turns: RawTurn[], itemId: string): number {
  for (let i = 0; i < turns.length; i++) {
    const items = turns[i].items;
    for (const item of items) {
      if ((item as { id?: unknown })?.id === itemId) return i;
    }
  }
  return -1;
}
