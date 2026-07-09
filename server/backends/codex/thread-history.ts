import type { JsonRpcLiteClient } from "./client.ts";

export interface RawTurn {
  id: string;
  items: unknown[];
}

export async function readThreadTurns(client: JsonRpcLiteClient, threadId: string): Promise<RawTurn[]> {
  const resp = await client.request<{ thread: { turns?: unknown[] } }>("thread/read", { threadId, includeTurns: true });
  const rawTurns = resp.thread?.turns ?? [];
  return rawTurns.map((raw): RawTurn => {
    const t = raw as { id?: unknown; items?: unknown };
    return {
      id: typeof t?.id === "string" ? t.id : "",
      items: Array.isArray(t?.items) ? t.items : [],
    };
  });
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
