import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, utimesSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { dirname, join } from "path";
import type { AuthResult } from "../../auth/auth-middleware.ts";
import { loadSessionsMap } from "../../persistence/logs/sessions.ts";
import type { PruneDeps } from "../../storage/prune.ts";
import { handleStorageRequest, type StorageRouteDeps } from "../storage.ts";

const ownerAuth: AuthResult = {
  kind: "ok",
  session: {
    sessionIdHash: "hash-1",
    sessionPrefix: "sess",
    userId: "owner-1",
    username: "Owner",
    role: "owner",
    needsRolling: false,
    absoluteExpiresAt: Date.now() + 86_400_000,
  },
};

const memberAuth: AuthResult = {
  kind: "ok",
  session: {
    sessionIdHash: "hash-2",
    sessionPrefix: "sess",
    userId: "member-1",
    username: "Member",
    role: "member",
    needsRolling: false,
    absoluteExpiresAt: Date.now() + 86_400_000,
  },
};

describe("handleStorageRequest", () => {
  test("returns null for unrelated routes", async () => {
    const req = new Request("http://local.test/api/tasks");

    expect(await handleStorageRequest(req, new URL(req.url), ownerAuth)).toBeNull();
  });

  test("requires a browser session", async () => {
    const req = new Request("http://local.test/api/storage/usage");

    const res = await handleStorageRequest(req, new URL(req.url), { kind: "loopback" });

    expect(res?.status).toBe(401);
    expect(await res?.json()).toEqual({ error: "unauthenticated" });
  });

  test("requires owner access", async () => {
    const req = new Request("http://local.test/api/storage/usage");

    const res = await handleStorageRequest(req, new URL(req.url), memberAuth);

    expect(res?.status).toBe(403);
    expect(await res?.json()).toEqual({ error: "owner access required" });
  });

  test("returns storage usage for owners", async () => {
    const req = new Request("http://local.test/api/storage/usage");

    const res = await handleStorageRequest(req, new URL(req.url), ownerAuth);
    const body = await res?.json();

    expect(res?.status).toBe(200);
    expect(body.stateRoot).toBeString();
    expect(body.stateRootBytes).toBeNumber();
    expect(body.categories.map((category: { id: string }) => category.id)).toEqual(["transcripts", "attachments", "metadata", "codex-home", "cronjobs", "memory", "other-state", "backups"]);
  });

  test("plans storage pruning without deleting by default", async () => {
    const { routeDeps, logsDir } = pruneRouteFixture();
    const req = pruneRequest({ target: "transcripts", olderThanDays: 30, keepPerAgent: 0 });

    const res = await handleStorageRequest(req, new URL(req.url), ownerAuth, routeDeps);
    const body = await res?.json();

    expect(res?.status).toBe(200);
    expect(body.applied).toBeNull();
    expect(body.plan.candidates.map((candidate: { path: string }) => candidate.path).sort()).toEqual(["agent-old/a.jsonl", "agent-old/b.jsonl"]);
    expect(existsSync(join(logsDir, "agent-old", "a.jsonl"))).toBe(true);
    expect(existsSync(join(logsDir, "agent-old", "b.jsonl"))).toBe(true);
  });

  test("applies storage pruning only when explicitly requested", async () => {
    const { routeDeps, logsDir } = pruneRouteFixture();
    const req = pruneRequest({ target: "transcripts", olderThanDays: 30, keepPerAgent: 1, apply: true });

    const res = await handleStorageRequest(req, new URL(req.url), ownerAuth, routeDeps);
    const body = await res?.json();

    expect(res?.status).toBe(200);
    expect(body.applied.deleted).toBe(1);
    const survivors = ["a.jsonl", "b.jsonl"].filter((name) => existsSync(join(logsDir, "agent-old", name)));
    expect(survivors).toHaveLength(1);
  });

  test("requires keepPerAgent for transcript apply", async () => {
    const { routeDeps, logsDir } = pruneRouteFixture();
    const req = pruneRequest({ target: "transcripts", olderThanDays: 30, apply: true });

    const res = await handleStorageRequest(req, new URL(req.url), ownerAuth, routeDeps);

    expect(res?.status).toBe(400);
    expect(await res?.json()).toEqual({ error: "keepPerAgent is required when applying transcript pruning" });
    expect(existsSync(join(logsDir, "agent-old", "a.jsonl"))).toBe(true);
  });

  test("prunes only orphaned old attachments", async () => {
    const { routeDeps, logsDir } = pruneRouteFixture();
    writeAged(join(logsDir, "agent-old", "live.jsonl"), JSON.stringify({ attachments: [{ filename: "kept.png" }] }) + "\n", 100);
    writeAged(join(logsDir, "agent-old", "files", "kept.png"), "kept", 100);
    writeAged(join(logsDir, "agent-old", "files", "orphan.png"), "orphan", 100);

    const req = pruneRequest({ target: "attachments", olderThanDays: 30, apply: true });
    const res = await handleStorageRequest(req, new URL(req.url), ownerAuth, routeDeps);
    const body = await res?.json();

    expect(res?.status).toBe(200);
    expect(body.plan.candidates.map((candidate: { path: string }) => candidate.path)).toContain("agent-old/files/orphan.png");
    expect(body.applied.deleted).toBe(1);
    expect(existsSync(join(logsDir, "agent-old", "files", "orphan.png"))).toBe(false);
    expect(existsSync(join(logsDir, "agent-old", "files", "kept.png"))).toBe(true);
  });
});

const DAY_MS = 24 * 60 * 60 * 1000;

function pruneRequest(body: unknown): Request {
  return new Request("http://local.test/api/storage/prune", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function writeAged(path: string, content: string, ageDays: number) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
  const seconds = (Date.now() - ageDays * DAY_MS) / 1000;
  utimesSync(path, seconds, seconds);
}

function pruneRouteFixture(): { routeDeps: StorageRouteDeps; logsDir: string } {
  const root = mkdtempSync(join(tmpdir(), "bureau-prune-route-"));
  const logsDir = join(root, "logs");
  writeAged(join(logsDir, "agent-old", "a.jsonl"), "a", 100);
  writeAged(join(logsDir, "agent-old", "b.jsonl"), "bb", 200);
  const pruneDeps = (): PruneDeps => ({
    logsDir,
    now: Date.now(),
    activeSessionIds: new Set(),
    loadSessionsMap,
    queuedAttachments: () => new Set(),
  });
  return {
    logsDir,
    routeDeps: {
      stateRoot: root,
      logsDir,
      backupDir: null,
      now: Date.now,
      pruneDeps,
    },
  };
}
