import { describe, expect, test } from "bun:test";
import { readThreadTurns } from "../thread-history.ts";

describe("readThreadTurns", () => {
  test("pages turns and items, preserving turn order", async () => {
    const requests: Array<{ method: string; params: Record<string, unknown> }> = [];
    const client = {
      async request<T>(method: string, params: Record<string, unknown>): Promise<T> {
        requests.push({ method, params });
        if (method === "thread/turns/list") {
          if (params.cursor === null) {
            return {
              data: [{ id: "turn-1" }, { id: "turn-2" }],
              nextCursor: "turn-page-2",
            } as T;
          }
          return {
            data: [{ id: "turn-2" }, { id: "turn-3" }],
            nextCursor: null,
          } as T;
        }
        if (method === "thread/items/list") {
          if (params.cursor === null) {
            return {
              data: [
                { turnId: "turn-2", item: { id: "item-2" } },
                { turnId: "turn-1", item: { id: "item-1" } },
              ],
              nextCursor: "item-page-2",
            } as T;
          }
          return {
            data: [
              { turnId: "turn-3", item: { id: "item-3" } },
              { turnId: "missing", item: { id: "ignored" } },
            ],
            nextCursor: null,
          } as T;
        }
        throw new Error(`unexpected method ${method}`);
      },
    };

    await expect(readThreadTurns(client, "thread-1")).resolves.toEqual([
      { id: "turn-1", items: [{ id: "item-1" }] },
      { id: "turn-2", items: [{ id: "item-2" }] },
      { id: "turn-3", items: [{ id: "item-3" }] },
    ]);
    expect(requests.map((r) => r.method)).toEqual(["thread/turns/list", "thread/turns/list", "thread/items/list", "thread/items/list"]);
    expect(requests[0].params).toMatchObject({ threadId: "thread-1", limit: 100, sortDirection: "asc", itemsView: "notLoaded" });
    expect(requests[2].params).toMatchObject({ threadId: "thread-1", limit: 100, sortDirection: "asc" });
  });

  test("rejects repeated cursors", async () => {
    const client = {
      async request<T>(method: string): Promise<T> {
        if (method === "thread/turns/list") {
          return { data: [], nextCursor: "same" } as T;
        }
        return { data: [], nextCursor: null } as T;
      },
    };

    await expect(readThreadTurns(client, "thread-1")).rejects.toThrow("thread/turns/list returned a repeated cursor");
  });
});
