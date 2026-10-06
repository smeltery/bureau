import { describe, expect, test } from "bun:test";
import type { PagerEntry } from "../../shared/types.ts";
import { openPagesFor } from "./usePager.ts";

function page(id: string, targetUserId: string, state: PagerEntry["state"]): PagerEntry {
  return {
    id,
    createdAt: 0,
    lastRaisedAt: 0,
    raiseCount: 1,
    source: { kind: "agent", id: "a", name: "A", roomId: null },
    targetUserId,
    title: id,
    state,
    delivery: { lastAttemptAt: null, sends: 0, failure: null },
  };
}

describe("openPagesFor", () => {
  test("counts only open pages addressed to the member", () => {
    const pages = [page("1", "me", "open"), page("2", "me", "acked"), page("3", "me", "resolved"), page("4", "someone", "open"), page("5", "me", "open")];
    expect(openPagesFor(pages, "me")).toBe(2);
    expect(openPagesFor(pages, undefined)).toBe(0);
  });
});
