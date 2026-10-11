import { expect, test } from "bun:test";
import { join } from "node:path";
import { readFileSync, rmSync } from "node:fs";
import { atomicWriteFileSync, BUREAU_DIR } from "../persistence/paths.ts";
import { withAuditContext } from "./context.ts";
import { auditFileWrite, readAuditPage } from "./store.ts";

test("audit records successful and failed writes without retaining secrets", () => {
  const actor = `audit-test-${crypto.randomUUID()}`;
  const path = join(BUREAU_DIR, `${actor}.json`);
  try {
    withAuditContext({ actor, operation: "edit" }, () => atomicWriteFileSync(path, JSON.stringify({ title: "First", credential: "never-store-this-secret" })));
    withAuditContext({ actor, operation: "edit" }, () => atomicWriteFileSync(path, JSON.stringify({ title: "Second", credential: "new-secret" })));
    expect(() =>
      withAuditContext({ actor, operation: "failure" }, () =>
        auditFileWrite(path, "failure", () => {
          throw new Error("disk failed");
        }),
      ),
    ).toThrow("disk failed");
    const entries = readAuditPage({ actor }).entries;
    expect(entries).toHaveLength(3);
    expect(entries.filter((entry) => entry.outcome === "committed")).toHaveLength(2);
    expect(entries.find((entry) => entry.operation === "failure")?.outcome).toBe("failed");
    expect(entries.find((entry) => entry.operation === "edit")?.fields).toContain("title");
    expect(JSON.stringify(entries)).not.toContain("secret");
    expect(JSON.stringify(entries)).not.toContain("First");
    expect(readFileSync(path, "utf8")).toContain("Second");
    expect(() => readAuditPage({ cursor: "../../outside" })).toThrow("invalid cursor");
  } finally {
    rmSync(path, { force: true });
  }
});

test("concurrent audit scopes retain their actors and stop when the request finishes", async () => {
  const actor = `audit-concurrent-${crypto.randomUUID()}`;
  const paths = [join(BUREAU_DIR, `${actor}-a.json`), join(BUREAU_DIR, `${actor}-b.json`)];
  try {
    await Promise.all(
      paths.map((path, index) =>
        withAuditContext({ actor: `${actor}-${index}`, operation: "edit" }, async () => {
          await Bun.sleep(index * 5);
          atomicWriteFileSync(path, "before");
          setTimeout(() => atomicWriteFileSync(path, "background"), 20);
        }),
      ),
    );
    await Bun.sleep(50);
    const entries = readAuditPage({ actor }).entries;
    expect(entries).toHaveLength(2);
    expect(entries.map((entry) => entry.actor).sort()).toEqual([`${actor}-0`, `${actor}-1`]);
  } finally {
    for (const path of paths) rmSync(path, { force: true });
  }
});

test("audit cursors traverse retained entries without duplication", () => {
  const actor = `audit-pages-${crypto.randomUUID()}`;
  const path = join(BUREAU_DIR, `${actor}.json`);
  try {
    for (let i = 0; i < 55; i++) withAuditContext({ actor, operation: "edit" }, () => atomicWriteFileSync(path, String(i)));
    const first = readAuditPage({ actor });
    const second = readAuditPage({ actor, cursor: first.nextCursor! });
    expect(first.entries).toHaveLength(50);
    expect(second.entries).toHaveLength(5);
    expect(new Set([...first.entries, ...second.entries].map((entry) => entry.id)).size).toBe(55);
    expect(second.nextCursor).toBeNull();
  } finally {
    rmSync(path, { force: true });
  }
});
