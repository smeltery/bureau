import { afterAll, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PagerEntry } from "../../../shared/types.ts";
import { createPagerArchive } from "./archive.ts";

const root = mkdtempSync(join(tmpdir(), "bureau-pager-archive-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));
const archive = createPagerArchive(join(root, "history"));
function page(id: string, resolvedAt: number, targetUserId = "member"): PagerEntry {
  return {
    id,
    createdAt: 1,
    lastRaisedAt: 1,
    resolvedAt,
    resolvedBy: "Boss",
    raiseCount: 1,
    source: { kind: "agent", id: "agent", name: "Agent", roomId: null },
    targetUserId,
    title: id,
    state: "resolved",
    delivery: { lastAttemptAt: null, sends: 0, failure: null },
  };
}

test("paginates retained history after access filtering with stable ties", async () => {
  for (let i = 0; i < 60; i++) archive.save(page(`page-${String(i).padStart(3, "0")}`, Math.floor(i / 2), i % 3 === 0 ? "hidden" : "member"));
  const seen: string[] = [];
  let cursor: string | null = null;
  do {
    const result = await archive.list({ visible: (entry) => entry.targetUserId === "member", limit: 7, cursor });
    expect(result.pages.length).toBeLessThanOrEqual(7);
    expect(result.pages.every((entry) => entry.targetUserId === "member")).toBe(true);
    seen.push(...result.pages.map((entry) => entry.id));
    cursor = result.nextCursor;
  } while (cursor);
  expect(seen).toHaveLength(40);
  expect(new Set(seen).size).toBe(40);
  expect(seen.slice(0, 2)).toEqual(["page-059", "page-058"]);
  expect(archive.read(seen.at(-1)!)).toMatchObject({ id: seen.at(-1), state: "resolved" });
  expect(archive.read("../../secret")).toBeUndefined();
});

test("rejects invalid cursors and bounds requested history windows", async () => {
  await expect(archive.list({ visible: () => true, cursor: "bad" })).rejects.toThrow("cursor");
  await expect(archive.list({ visible: () => true, limit: 101 })).rejects.toThrow("limit");
  expect(await createPagerArchive(join(root, "absent")).list({ visible: () => true })).toEqual({ pages: [], nextCursor: null });
});

test("reports failed writes and corrupt history without replacing retained data", async () => {
  const failed = createPagerArchive(join(root, "failure"), () => {
    throw new Error("disk full");
  });
  expect(() => failed.save(page("failed", 1))).toThrow("disk full");
  expect(failed.read("failed")).toBeUndefined();
  writeFileSync(join(root, "history", "corrupt.json"), "broken");
  expect(() => archive.read("corrupt")).toThrow();
  await expect(archive.list({ visible: () => true })).rejects.toThrow();
});
